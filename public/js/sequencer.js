// ═══════════════════════════════════════════════════════════════
//  Sequencer Module
//  Dependencies: ws (WebSocket), esc(), formatDuration() from main app
// ═══════════════════════════════════════════════════════════════

let seqLoaded = false;
let seqSequences = [];
let seqCurrentId = null;
let seqCurrentSeq = null;
let seqCues = [];
let seqFixtures = [];
let seqEffects = [];
let seqActiveLanes = new Set(); // fixture IDs active as lanes
let seqZoomPxPerSec = 5;
let seqSnapBeats = 4;
let seqSelectedCueId = null;
let seqSelectedCueIds = new Set(); // multi-select
let seqClipboard = null; // copied cue data for paste (array for multi)
let seqMarquee = null; // rubber-band selection state
let seqDeck = 1;
let seqPlayheadMs = 0;
let seqIsPlaying = false;
let seqDragState = null;
let seqIsDraggingPlayhead = false;
let seqEditingEffectId = null;
let seqExpandedFixtures = new Set(); // fixture IDs whose cells are expanded
let seqMoverPresets = []; // cached mover presets for movement cue type

async function loadSequencer() {
  if (!seqLoaded) {
    seqLoaded = true;
    setupSequencerEvents();
  }
  const [seqRes, fixRes, effRes, mpRes] = await Promise.all([
    fetch('/api/sequences').then(r => r.json()),
    fetch('/api/fixture-channel-map').then(r => r.json()),
    fetch('/api/effects').then(r => r.json()),
    fetch('/api/mover-presets').then(r => r.json()),
  ]);
  seqSequences = seqRes;
  seqFixtures = fixRes;
  seqEffects = effRes;
  seqMoverPresets = mpRes;

  refreshEffectDropdown();
  refreshMoverPresetDropdown();
  renderEffectsList();
  renderSeqSelector();
  if (seqCurrentId) {
    document.getElementById('seqSelector').value = seqCurrentId;
    await loadSequenceById(seqCurrentId);
  }
}

function refreshEffectDropdown() {
  const effSel = document.getElementById('seqPropEffect');
  effSel.innerHTML = '<option value="">None</option>';
  for (const eff of seqEffects) {
    effSel.innerHTML += `<option value="${eff.id}">${esc(eff.name)} (${eff.type})</option>`;
  }
}

function refreshMoverPresetDropdown() {
  const sel = document.getElementById('seqPropMoverPreset');
  sel.innerHTML = '<option value="">-- Select Preset --</option>';
  for (const mp of seqMoverPresets) {
    sel.innerHTML += `<option value="${mp.id}">${esc(mp.name)}</option>`;
  }
}

function updateMoverPresetVisibility(cueType) {
  const show = cueType === 'movement';
  document.getElementById('seqPropMoverPresetLabel').style.display = show ? '' : 'none';
  document.getElementById('seqPropMoverPreset').style.display = show ? '' : 'none';
}

function renderSeqSelector() {
  const sel = document.getElementById('seqSelector');
  sel.innerHTML = '<option value="">-- Select Sequence --</option>';
  for (const s of seqSequences) {
    sel.innerHTML += `<option value="${s.id}">${esc(s.name)}</option>`;
  }
  if (seqCurrentId) sel.value = seqCurrentId;
}

async function loadSequenceById(id) {
  if (!id) {
    seqCurrentId = null;
    seqCurrentSeq = null;
    seqCues = [];
    seqActiveLanes = new Set();
    seqSelectedCueId = null;
    seqSelectedCueIds.clear();
    wfAnalysisData = null;
    wfWaveformData = null;
    wfRawPeaks = null;
    wfTrackInfo = null;
    wfCurrentTrackId = null;
    if (typeof loadAudioForTrack === 'function') loadAudioForTrack(null);
    document.getElementById('seqBpmDisplay').textContent = '--';
    document.getElementById('seqDurDisplay').textContent = '--';
    document.getElementById('seqCueCount').textContent = '0';
    document.getElementById('seqProperties').classList.remove('open');
    document.getElementById('seqFixturePicker').style.display = 'none';
    renderSequencerTimeline();
    return;
  }
  const [seq, cues] = await Promise.all([
    fetch(`/api/sequences/${id}`).then(r => r.json()),
    fetch(`/api/sequences/${id}/cues`).then(r => r.json()),
  ]);
  seqCurrentId = seq.id;
  seqCurrentSeq = seq;
  seqCues = cues;
  // Clear previous waveform so stale data doesn't show during fetch
  wfAnalysisData = null;
  wfWaveformData = null;
  wfRawPeaks = null;
  wfTrackInfo = null;
  wfCurrentTrackId = null;
  // Initialize active lanes from existing cues + let user add more
  seqActiveLanes = new Set(cues.map(c => c.fixture_id).filter(Boolean));
  document.getElementById('seqBpmDisplay').textContent = seq.bpm ? seq.bpm.toFixed(1) : '--';
  document.getElementById('seqDurDisplay').textContent = formatDuration(seq.duration_ms / 1000);
  document.getElementById('seqCueCount').textContent = cues.length;
  renderFixturePicker();
  renderSequencerTimeline();

  // Auto-load waveform if track has analysis
  if (seq.track_id && typeof loadAndShowWaveform === 'function') {
    loadAndShowWaveform(seq.track_id);
  }

  // Auto-load audio player if track exists
  if (seq.track_id && typeof loadAudioForTrack === 'function') {
    loadAudioForTrack(seq.track_id, seq.name);
  }
}

function renderCueBlock(cue) {
  const left = (cue.start_ms / 1000) * seqZoomPxPerSec;
  const width = Math.max(4, (cue.duration_ms / 1000) * seqZoomPxPerSec);
  const selected = seqSelectedCueIds.has(cue.id) ? ' selected' : '';
  const chV = cue.channel_values || {};
  const endV = cue.end_channel_values || {};
  const startColor = (chV.red !== undefined || chV.green !== undefined || chV.blue !== undefined)
    ? colorFromChannelValues(chV) : (cue.color || '#e94560');
  const hasEndRGB = endV.red !== undefined || endV.green !== undefined || endV.blue !== undefined;
  let bgStyle;
  if (hasEndRGB && cue.cue_type !== 'solid') {
    const endColor = colorFromChannelValues(endV);
    bgStyle = `background:linear-gradient(to right, ${startColor}, ${endColor})`;
  } else {
    bgStyle = `background:${startColor}`;
  }
  let typeLabel = cue.label || (cue.cue_type === 'solid' ? '' : cue.cue_type);
  if (cue.cue_type === 'movement' && chV.mover_preset_id) {
    const mp = seqMoverPresets.find(p => p.id === chV.mover_preset_id);
    if (mp) typeLabel = mp.name;
  }
  return `<div class="seq-cue${selected}" data-cue-id="${cue.id}" ` +
    `style="left:${left}px;width:${width}px;${bgStyle}" ` +
    `title="${esc(cue.label || cue.cue_type)} (${(cue.start_ms/1000).toFixed(2)}s - ${(cue.duration_ms/1000).toFixed(2)}s)">` +
    `${esc(typeLabel)}<div class="seq-cue-resize"></div></div>`;
}

function renderSequencerTimeline() {
  const emptyEl = document.getElementById('seqEmpty');
  const timelineEl = document.getElementById('seqTimeline');
  const rulerEl = document.getElementById('seqRuler');
  const lanesWrap = document.getElementById('seqLanesWrap');
  const playhead = document.getElementById('seqPlayhead');

  if (!seqCurrentSeq) {
    emptyEl.style.display = 'flex';
    timelineEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  timelineEl.style.display = 'block';

  const durationMs = seqCurrentSeq.duration_ms || 180000;
  const durationSec = durationMs / 1000;
  const totalWidth = durationSec * seqZoomPxPerSec;
  const bpm = seqCurrentSeq.bpm || 128;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;

  timelineEl.style.width = (totalWidth + 140) + 'px';
  rulerEl.style.width = totalWidth + 'px';

  // Ruler marks
  let rulerHtml = '';
  let markTime = 0, beatCount = 0;
  while (markTime < durationMs) {
    const x = (markTime / 1000) * seqZoomPxPerSec;
    const isBar = beatCount % 4 === 0;
    const barNum = Math.floor(beatCount / 4) + 1;
    const beatInBar = (beatCount % 4) + 1;
    if (isBar || seqZoomPxPerSec >= 30) {
      rulerHtml += `<div class="seq-ruler-mark${isBar ? ' bar' : ''}" style="left:${x}px">` +
        `<span class="seq-rm-label">${isBar ? barNum : barNum + '.' + beatInBar}</span></div>`;
    }
    beatCount++;
    markTime += beatMs;
  }
  rulerEl.innerHTML = rulerHtml;

  // Build lanes from active fixtures
  const laneFixes = [];
  // First: fixtures with cues (in lane order)
  const laneMap = new Map();
  for (const cue of seqCues) {
    if (cue.fixture_id && !laneMap.has(cue.fixture_id)) {
      laneMap.set(cue.fixture_id, cue.lane);
    }
  }
  const sortedFixes = [...laneMap.entries()].sort((a, b) => a[1] - b[1]);
  for (const [fixId] of sortedFixes) {
    const fix = seqFixtures.find(f => f.id === fixId);
    if (fix) laneFixes.push(fix);
  }
  // Then: any additional fixtures the user has toggled on in the picker
  for (const fixId of seqActiveLanes) {
    if (!laneFixes.some(f => f.id === fixId)) {
      const fix = seqFixtures.find(f => f.id === fixId);
      if (fix) laneFixes.push(fix);
    }
  }
  // Show message if no fixtures and no waveform
  if (laneFixes.length === 0 && !wfAnalysisData) {
    lanesWrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:13px">' +
      'No fixtures added. Use the fixture picker above to add lights to this sequence.</div>';
    updatePlayhead();
    return;
  }

  // Render lanes
  let lanesHtml = '';

  // Waveform lane (above fixture lanes)
  if (wfAnalysisData && wfWaveformData) {
    const wfTitle = wfTrackInfo
      ? (wfTrackInfo.title || wfTrackInfo.filename || 'Waveform')
      : 'Waveform';
    lanesHtml += `<div class="seq-lane seq-waveform-lane">` +
      `<div class="seq-lane-header seq-wf-header">` +
      `<div class="seq-lh-color" style="background:var(--accent)"></div>` +
      `<span class="wf-title" title="${esc(wfTitle)}">${esc(wfTitle)}</span></div>` +
      `<div class="seq-lane-track seq-wf-track"><canvas id="seqWfCanvas"></canvas></div></div>`;
  }
  for (let i = 0; i < laneFixes.length; i++) {
    const fix = laneFixes[i];
    const isMultiCell = fix.cell_count > 0;
    const isMover = !isMultiCell && fix.channels.some(c => c.type === 'pan') && fix.channels.some(c => c.type === 'tilt');
    const isExpanded = (isMultiCell || isMover) && seqExpandedFixtures.has(fix.id);
    const hasRGB = fix.channels.some(c => c.type === 'red');

    // Build grid lines (reused for all sub-lanes)
    let gridHtml = '';
    let gt = 0; beatCount = 0;
    while (gt < durationMs) {
      const gx = (gt / 1000) * seqZoomPxPerSec;
      const isBar = beatCount % 4 === 0;
      gridHtml += `<div class="seq-grid-line ${isBar ? 'bar' : 'beat'}" style="left:${gx}px"></div>`;
      beatCount++;
      gt += beatMs;
    }

    // Expand/collapse toggle for multi-cell or mover fixtures
    const expandToggle = (isMultiCell || isMover)
      ? `<span class="seq-cell-toggle" data-fix-id="${fix.id}" title="${isExpanded ? 'Collapse' : 'Expand'}">${isExpanded ? '&#9660;' : '&#9654;'}</span>`
      : '';

    if (!isExpanded) {
      // Single lane (collapsed or simple fixture): show ALL cues for this fixture
      const fixCues = seqCues.filter(c => c.fixture_id === fix.id);
      let cuesHtml = '';
      for (const cue of fixCues) {
        cuesHtml += renderCueBlock(cue);
      }

      lanesHtml += `<div class="seq-lane" data-fixture-id="${fix.id}" data-lane="${i}">` +
        `<div class="seq-lane-header">` +
        `${expandToggle}` +
        `<div class="seq-lh-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
        `<span>${esc(fix.name)}</span></div>` +
        `<div class="seq-lane-track" data-fixture-id="${fix.id}">${gridHtml}${cuesHtml}</div></div>`;
    } else if (isMover) {
      // Mover expanded: Light sub-lane + Movement sub-lane
      const lightCues = seqCues.filter(c => c.fixture_id === fix.id && c.label !== 'move');
      let lightCuesHtml = '';
      for (const cue of lightCues) lightCuesHtml += renderCueBlock(cue);

      lanesHtml += `<div class="seq-lane seq-lane-mover-light" data-fixture-id="${fix.id}" data-lane="${i}" data-sublane="light">` +
        `<div class="seq-lane-header">` +
        `${expandToggle}` +
        `<div class="seq-lh-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
        `<span>${esc(fix.name)} <small style="color:var(--text-dim)">[Light]</small></span></div>` +
        `<div class="seq-lane-track" data-fixture-id="${fix.id}" data-sublane="light">${gridHtml}${lightCuesHtml}</div></div>`;

      const moveCues = seqCues.filter(c => c.fixture_id === fix.id && c.label === 'move');
      let moveCuesHtml = '';
      for (const cue of moveCues) moveCuesHtml += renderCueBlock(cue);

      lanesHtml += `<div class="seq-lane seq-lane-mover-move" data-fixture-id="${fix.id}" data-lane="${i}" data-sublane="movement">` +
        `<div class="seq-lane-header seq-cell-header">` +
        `<div class="seq-lh-color" style="background:#4488ff"></div>` +
        `<span style="font-size:11px">${esc(fix.name)} <small style="color:var(--text-dim)">[Movement]</small></span></div>` +
        `<div class="seq-lane-track" data-fixture-id="${fix.id}" data-sublane="movement">${gridHtml}${moveCuesHtml}</div></div>`;
    } else {
      // Multi-cell expanded: show sub-lanes per cell + optional master lane
      const hasMasterChannels = fix.channels.some(ch => !ch.cell);

      // Master lane (channels with no cell assignment)
      if (hasMasterChannels) {
        const masterCues = seqCues.filter(c => c.fixture_id === fix.id && !c.cell);
        let masterCuesHtml = '';
        for (const cue of masterCues) masterCuesHtml += renderCueBlock(cue);

        lanesHtml += `<div class="seq-lane seq-lane-master" data-fixture-id="${fix.id}" data-lane="${i}" data-cell="0">` +
          `<div class="seq-lane-header">` +
          `${expandToggle}` +
          `<div class="seq-lh-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
          `<span>${esc(fix.name)} <small style="color:var(--text-dim)">[Master]</small></span></div>` +
          `<div class="seq-lane-track" data-fixture-id="${fix.id}" data-cell="0">${gridHtml}${masterCuesHtml}</div></div>`;
      }

      // Per-cell sub-lanes
      for (let cell = 1; cell <= fix.cell_count; cell++) {
        const cellCues = seqCues.filter(c => c.fixture_id === fix.id && c.cell === cell);
        let cellCuesHtml = '';
        for (const cue of cellCues) cellCuesHtml += renderCueBlock(cue);

        const cellHasRGB = fix.channels.some(ch => ch.cell === cell && ch.type === 'red');
        lanesHtml += `<div class="seq-lane seq-lane-cell" data-fixture-id="${fix.id}" data-lane="${i}" data-cell="${cell}">` +
          `<div class="seq-lane-header seq-cell-header">` +
          `${!hasMasterChannels && cell === 1 ? expandToggle : ''}` +
          `<div class="seq-lh-color" style="background:${cellHasRGB ? '#e94560' : '#888'}"></div>` +
          `<span style="font-size:11px">${esc(fix.name)} <small style="color:var(--text-dim)">Cell ${cell}</small></span></div>` +
          `<div class="seq-lane-track" data-fixture-id="${fix.id}" data-cell="${cell}">${gridHtml}${cellCuesHtml}</div></div>`;
      }
    }
  }
  lanesWrap.innerHTML = lanesHtml;

  // Bind cell expand/collapse toggles
  lanesWrap.querySelectorAll('.seq-cell-toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const fixId = +el.dataset.fixId;
      if (seqExpandedFixtures.has(fixId)) seqExpandedFixtures.delete(fixId);
      else seqExpandedFixtures.add(fixId);
      renderSequencerTimeline();
    });
  });

  // Draw waveform on the canvas (defer to next frame so DOM is laid out)
  if (wfAnalysisData && wfWaveformData && typeof drawTimelineWaveform === 'function') {
    requestAnimationFrame(() => drawTimelineWaveform());
  }

  // Default scroll to left edge
  document.getElementById('seqTimelineWrap').scrollLeft = 0;

  updatePlayhead();
}

function updatePlayhead() {
  const ph = document.getElementById('seqPlayhead');
  if (!seqCurrentSeq) { ph.style.display = 'none'; return; }
  ph.style.display = 'block';
  const x = (seqPlayheadMs / 1000) * seqZoomPxPerSec;
  ph.style.left = (x + 140) + 'px';
  const secs = seqPlayheadMs / 1000;
  document.getElementById('seqTimeDisplay').textContent =
    `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}.${String(Math.floor((secs % 1) * 10))}`;
}

function snapToGrid(ms) {
  if (!seqSnapBeats || !seqCurrentSeq?.bpm) return ms;
  const beatMs = 60000 / seqCurrentSeq.bpm;
  const snapMs = beatMs * seqSnapBeats;
  return Math.round(ms / snapMs) * snapMs;
}

// ─── Seek / Audio Sync Helpers ───────────────────────────────────────────────

function syncAudioToPlayhead() {
  const audioEl = document.getElementById('audioElement');
  if (audioEl && audioEl.src && !isNaN(audioEl.duration)) {
    audioEl.currentTime = seqPlayheadMs / 1000;
  }
}

function seekSequence(timeMs) {
  seqPlayheadMs = timeMs;
  updatePlayhead();
  syncAudioToPlayhead();
  // Tell the server to jump to this position if a sequence is loaded
  if (seqCurrentId) {
    ws.send(JSON.stringify({ type: 'sequence', action: 'seek', deck: seqDeck, timeMs: seqPlayheadMs }));
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

function setupSequencerEvents() {
  // Sequence selector
  document.getElementById('seqSelector').addEventListener('change', (e) => {
    loadSequenceById(+e.target.value || null);
  });

  // New sequence
  document.getElementById('seqNewBtn').addEventListener('click', async () => {
    const name = prompt('Sequence name:', 'New Sequence');
    if (!name) return;
    const bpm = +(prompt('BPM:', '128') || 128);
    const durSec = +(prompt('Duration (seconds):', '180') || 180);
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bpm, duration_ms: durSec * 1000 })
    });
    const seq = await res.json();
    seqSequences.push(seq);
    renderSeqSelector();
    document.getElementById('seqSelector').value = seq.id;
    await loadSequenceById(seq.id);
  });

  // Delete sequence
  document.getElementById('seqDeleteBtn').addEventListener('click', async () => {
    if (!seqCurrentId) return;
    if (!confirm('Delete this sequence and all its cues?')) return;
    await fetch(`/api/sequences/${seqCurrentId}`, { method: 'DELETE' });
    seqSequences = seqSequences.filter(s => s.id !== seqCurrentId);
    seqCurrentId = null;
    seqCurrentSeq = null;
    seqCues = [];
    seqSelectedCueId = null;
    seqSelectedCueIds.clear();
    renderSeqSelector();
    renderSequencerTimeline();
    document.getElementById('seqProperties').classList.remove('open');
  });

  // Transport
  document.getElementById('seqPlayBtn').addEventListener('click', () => {
    if (!seqCurrentId) return;
    seqIsPlaying = true;
    seqPlayheadMs = 0;
    document.getElementById('seqPlayBtn').classList.add('active');
    updatePlayhead();
    ws.send(JSON.stringify({ type: 'sequence', action: 'load', deck: seqDeck, sequenceId: seqCurrentId }));
    ws.send(JSON.stringify({ type: 'sequence', action: 'play', deck: seqDeck }));
    // Also start audio playback
    const audioEl = document.getElementById('audioElement');
    if (audioEl && audioEl.src) {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
      document.getElementById('audioPlayBtn').innerHTML = '\u{23F8}';
    }
  });
  document.getElementById('seqPauseBtn').addEventListener('click', () => {
    seqIsPlaying = false;
    document.getElementById('seqPlayBtn').classList.remove('active');
    ws.send(JSON.stringify({ type: 'sequence', action: 'pause', deck: seqDeck }));
    // Also pause audio
    const audioEl = document.getElementById('audioElement');
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
      document.getElementById('audioPlayBtn').innerHTML = '&#9654;';
    }
  });
  document.getElementById('seqStopBtn').addEventListener('click', () => {
    seqIsPlaying = false;
    seqPlayheadMs = 0;
    document.getElementById('seqPlayBtn').classList.remove('active');
    updatePlayhead();
    ws.send(JSON.stringify({ type: 'sequence', action: 'unload', deck: seqDeck }));
    // Also stop and reset audio
    const audioEl = document.getElementById('audioElement');
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
      document.getElementById('audioPlayBtn').innerHTML = '&#9654;';
    }
  });

  // Deck selector
  document.getElementById('seqDeckSel').addEventListener('change', (e) => { seqDeck = +e.target.value; });

  // Zoom
  document.getElementById('seqZoomSlider').addEventListener('input', (e) => {
    seqZoomPxPerSec = +e.target.value;
    renderSequencerTimeline();
  });

  // Snap
  document.getElementById('seqSnapSel').addEventListener('change', (e) => { seqSnapBeats = +e.target.value; });

  // Double-click on lane track to add cue
  document.getElementById('seqLanesWrap').addEventListener('dblclick', async (e) => {
    const track = e.target.closest('.seq-lane-track');
    if (!track || !seqCurrentId) return;
    if (e.target.closest('.seq-cue')) return; // don't add when double-clicking existing cue

    const fixtureId = +track.dataset.fixtureId;
    const rect = track.getBoundingClientRect();
    const scrollWrap = document.getElementById('seqTimelineWrap');
    const clickX = e.clientX - rect.left;
    const clickMs = snapToGrid((clickX / seqZoomPxPerSec) * 1000);

    const bpm = seqCurrentSeq.bpm || 128;
    const durMs = (60000 / bpm) * 4; // default 1 bar
    const lane = +e.target.closest('.seq-lane').dataset.lane;
    const cellAttr = track.dataset.cell;
    const cell = cellAttr !== undefined ? +cellAttr : null;
    const sublane = track.dataset.sublane || null;

    let body;
    if (sublane === 'movement') {
      body = {
        lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs),
        cue_type: 'fade', fixture_id: fixtureId,
        channel_values: { pan: 128, tilt: 128 },
        end_channel_values: { pan: 128, tilt: 128 },
        color: '#4488ff', label: 'move',
      };
    } else {
      body = {
        lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs),
        cue_type: 'solid', fixture_id: fixtureId,
        channel_values: { red: 255, green: 0, blue: 0 },
        color: '#ff0000', label: '',
      };
    }
    if (cell) body.cell = cell;

    const res = await fetch(`/api/sequences/${seqCurrentId}/cues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const cue = await res.json();
    seqCues.push(cue);
    document.getElementById('seqCueCount').textContent = seqCues.length;
    renderSequencerTimeline();
    selectCue(cue.id);
  });

  // ─── Mousedown on lanes: cue click / marquee start ─────────────────────
  document.getElementById('seqLanesWrap').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const cueEl = e.target.closest('.seq-cue');

    if (cueEl) {
      // -- Click on a cue block --
      const cueId = +cueEl.dataset.cueId;
      const cue = seqCues.find(c => c.id === cueId);
      if (!cue) return;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: toggle in multi-selection
        if (seqSelectedCueIds.has(cueId)) {
          seqSelectedCueIds.delete(cueId);
          cueEl.classList.remove('selected');
          if (seqSelectedCueId === cueId) {
            seqSelectedCueId = seqSelectedCueIds.size > 0 ? [...seqSelectedCueIds][0] : null;
          }
        } else {
          seqSelectedCueIds.add(cueId);
          seqSelectedCueId = cueId;
          cueEl.classList.add('selected');
        }
        updateSelectionInfo();
      } else if (!seqSelectedCueIds.has(cueId)) {
        // Plain click on unselected cue: single select
        selectCue(cueId);
      }
      // else: plain click on already selected cue — keep selection for drag

      if (e.target.classList.contains('seq-cue-resize')) {
        // Resize only works on one cue
        seqDragState = {
          type: 'resize', cueId, startX: e.clientX,
          origWidth: parseFloat(cueEl.style.width), origDurMs: cue.duration_ms,
        };
      } else {
        // Move – capture orig positions for ALL selected cues
        const track = cueEl.closest('.seq-lane-track');
        const origLane = track ? (+track.dataset.fixtureId || null) : null;
        const items = [];
        for (const sid of seqSelectedCueIds) {
          const sc = seqCues.find(c => c.id === sid);
          const sel = document.querySelector(`.seq-cue[data-cue-id="${sid}"]`);
          if (sc && sel) {
            items.push({ cueId: sid, origLeft: parseFloat(sel.style.left), origStartMs: sc.start_ms });
          }
        }
        seqDragState = {
          type: 'move', cueId, startX: e.clientX, startY: e.clientY,
          origLeft: parseFloat(cueEl.style.left), origStartMs: cue.start_ms,
          items, origFixtureId: origLane, crossLane: false, hasMoved: false,
        };
      }
      e.preventDefault();
      return;
    }

    // -- Click on empty area: start rubber-band marquee --
    const track = e.target.closest('.seq-lane-track');
    if (!track) {
      // Clicked on header or empty area outside tracks — clear selection
      if (!e.ctrlKey && !e.metaKey) clearCueSelection();
      return;
    }
    if (!e.ctrlKey && !e.metaKey) clearCueSelection();

    const lanesWrap = document.getElementById('seqLanesWrap');
    const wrapRect = lanesWrap.getBoundingClientRect();
    const scrollWrap = document.getElementById('seqTimelineWrap');
    const startX = e.clientX - wrapRect.left + scrollWrap.scrollLeft;
    const startY = e.clientY - wrapRect.top + scrollWrap.scrollTop;

    let marqueeEl = document.getElementById('seqMarquee');
    if (!marqueeEl) {
      marqueeEl = document.createElement('div');
      marqueeEl.id = 'seqMarquee';
      marqueeEl.className = 'seq-marquee';
      lanesWrap.appendChild(marqueeEl);
    }
    marqueeEl.style.display = 'block';
    marqueeEl.style.left = startX + 'px';
    marqueeEl.style.top = startY + 'px';
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';

    seqMarquee = { startX, startY, additive: e.ctrlKey || e.metaKey };
    e.preventDefault();
  });

  // ─── Mousemove: drag cues / resize / marquee ──────────────────────────
  document.addEventListener('mousemove', (e) => {
    // Marquee
    if (seqMarquee) {
      const lanesWrap = document.getElementById('seqLanesWrap');
      const wrapRect = lanesWrap.getBoundingClientRect();
      const scrollWrap = document.getElementById('seqTimelineWrap');
      const curX = e.clientX - wrapRect.left + scrollWrap.scrollLeft;
      const curY = e.clientY - wrapRect.top + scrollWrap.scrollTop;
      const x = Math.min(seqMarquee.startX, curX);
      const y = Math.min(seqMarquee.startY, curY);
      const w = Math.abs(curX - seqMarquee.startX);
      const h = Math.abs(curY - seqMarquee.startY);
      const marqueeEl = document.getElementById('seqMarquee');
      if (marqueeEl) {
        marqueeEl.style.left = x + 'px';
        marqueeEl.style.top = y + 'px';
        marqueeEl.style.width = w + 'px';
        marqueeEl.style.height = h + 'px';
      }
      // Live highlight cues under marquee
      const mRect = { left: x, top: y, right: x + w, bottom: y + h };
      document.querySelectorAll('.seq-cue').forEach(cel => {
        const cid = +cel.dataset.cueId;
        const cr = {
          left: cel.offsetLeft,
          top: cel.closest('.seq-lane').offsetTop + cel.offsetTop,
          right: cel.offsetLeft + cel.offsetWidth,
          bottom: cel.closest('.seq-lane').offsetTop + cel.offsetTop + cel.offsetHeight,
        };
        const intersects = !(cr.right < mRect.left || cr.left > mRect.right || cr.bottom < mRect.top || cr.top > mRect.bottom);
        cel.classList.toggle('selected', intersects || (seqMarquee.additive && seqSelectedCueIds.has(cid)));
      });
      return;
    }

    // Cue drag / resize
    if (!seqDragState) return;
    const dx = e.clientX - seqDragState.startX;

    if (seqDragState.type === 'resize') {
      const cueEl = document.querySelector(`.seq-cue[data-cue-id="${seqDragState.cueId}"]`);
      if (cueEl) cueEl.style.width = Math.max(4, seqDragState.origWidth + dx) + 'px';
    } else if (seqDragState.type === 'move') {
      if (Math.abs(dx) > 2 || Math.abs(e.clientY - seqDragState.startY) > 2) seqDragState.hasMoved = true;
      // Move all selected cues horizontally
      for (const item of seqDragState.items) {
        const el = document.querySelector(`.seq-cue[data-cue-id="${item.cueId}"]`);
        if (el) el.style.left = Math.max(0, item.origLeft + dx) + 'px';
      }
      // Detect cross-lane drag (vertical movement)
      const dy = e.clientY - seqDragState.startY;
      seqDragState.crossLane = Math.abs(dy) > 18;
      // Show visual indicator for drop target lane
      document.querySelectorAll('.seq-lane-track').forEach(lt => lt.classList.remove('seq-drop-target'));
      if (seqDragState.crossLane) {
        const targetTrack = document.elementFromPoint(e.clientX, e.clientY)?.closest('.seq-lane-track');
        if (targetTrack) targetTrack.classList.add('seq-drop-target');
      }
    }
  });

  // ─── Mouseup: commit drag / marquee selection ─────────────────────────
  document.addEventListener('mouseup', async (e) => {
    // Marquee finish
    if (seqMarquee) {
      const marqueeEl = document.getElementById('seqMarquee');
      if (marqueeEl) marqueeEl.style.display = 'none';

      // Collect intersected cues
      const lanesWrap = document.getElementById('seqLanesWrap');
      const wrapRect = lanesWrap.getBoundingClientRect();
      const scrollWrap = document.getElementById('seqTimelineWrap');
      const curX = e.clientX - wrapRect.left + scrollWrap.scrollLeft;
      const curY = e.clientY - wrapRect.top + scrollWrap.scrollTop;
      const x = Math.min(seqMarquee.startX, curX);
      const y = Math.min(seqMarquee.startY, curY);
      const w = Math.abs(curX - seqMarquee.startX);
      const h = Math.abs(curY - seqMarquee.startY);
      const mRect = { left: x, top: y, right: x + w, bottom: y + h };

      if (!seqMarquee.additive) seqSelectedCueIds.clear();

      document.querySelectorAll('.seq-cue').forEach(cel => {
        const cid = +cel.dataset.cueId;
        const lane = cel.closest('.seq-lane');
        const cr = {
          left: cel.offsetLeft,
          top: lane.offsetTop + cel.offsetTop,
          right: cel.offsetLeft + cel.offsetWidth,
          bottom: lane.offsetTop + cel.offsetTop + cel.offsetHeight,
        };
        const intersects = !(cr.right < mRect.left || cr.left > mRect.right || cr.bottom < mRect.top || cr.top > mRect.bottom);
        if (intersects) seqSelectedCueIds.add(cid);
      });

      // Set primary to first in set
      seqSelectedCueId = seqSelectedCueIds.size > 0 ? [...seqSelectedCueIds][0] : null;
      seqMarquee = null;
      updateSelectionVisuals();
      updateSelectionInfo();
      return;
    }

    // Cue drag/resize finish
    if (!seqDragState) return;
    document.querySelectorAll('.seq-lane-track').forEach(lt => lt.classList.remove('seq-drop-target'));

    if (seqDragState.type === 'resize') {
      const cueId = seqDragState.cueId;
      const cue = seqCues.find(c => c.id === cueId);
      const cueEl = document.querySelector(`.seq-cue[data-cue-id="${cueId}"]`);
      if (cue && cueEl) {
        const newWidth = parseFloat(cueEl.style.width);
        cue.duration_ms = Math.max(100, Math.round(snapToGrid((newWidth / seqZoomPxPerSec) * 1000)));
        await fetch(`/api/cues/${cueId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration_ms: cue.duration_ms })
        });
      }
    } else if (seqDragState.type === 'move' && seqDragState.hasMoved) {
      // Determine if cross-lane drop
      let newFixtureId = null;
      if (seqDragState.crossLane) {
        const targetTrack = document.elementFromPoint(e.clientX, e.clientY)?.closest('.seq-lane-track');
        if (targetTrack) newFixtureId = +targetTrack.dataset.fixtureId || null;
      }

      // Update all selected cues
      const updates = [];
      for (const item of seqDragState.items) {
        const cue = seqCues.find(c => c.id === item.cueId);
        const el = document.querySelector(`.seq-cue[data-cue-id="${item.cueId}"]`);
        if (!cue || !el) continue;
        const newLeft = parseFloat(el.style.left);
        cue.start_ms = Math.max(0, Math.round(snapToGrid((newLeft / seqZoomPxPerSec) * 1000)));
        const body = { start_ms: cue.start_ms };
        if (newFixtureId && newFixtureId !== cue.fixture_id) {
          cue.fixture_id = newFixtureId;
          body.fixture_id = newFixtureId;
          // Ensure new fixture is in active lanes
          seqActiveLanes.add(newFixtureId);
        }
        updates.push(fetch(`/api/cues/${item.cueId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }));
      }
      await Promise.all(updates);
    }
    seqDragState = null;
    renderSequencerTimeline();
    updateSelectionVisuals();
  });

  // Apply cue properties (reusable)
  async function applyCurrentCueProperties() {
    if (!seqSelectedCueId) return;
    const cue = seqCues.find(c => c.id === seqSelectedCueId);
    if (!cue) return;

    const type = document.getElementById('seqPropType').value;
    const startMs = parseFloat(document.getElementById('seqPropStart').value) * 1000;
    const durMs = parseFloat(document.getElementById('seqPropDur').value) * 1000;
    const label = document.getElementById('seqPropLabel').value;
    const effectId = document.getElementById('seqPropEffect').value || null;

    const channelValues = {};
    document.querySelectorAll('#seqColorChannels .seq-ch-start .seq-ch-slider').forEach(sl => {
      channelValues[sl.dataset.chType] = +sl.querySelector('input[type="range"]').value;
    });

    // Derive color from RGB channels so timeline bar matches
    const color = (channelValues.red !== undefined || channelValues.green !== undefined || channelValues.blue !== undefined)
      ? colorFromChannelValues(channelValues)
      : document.getElementById('seqPropColor').value;

    let endChannelValues = null;
    const endSliders = document.querySelectorAll('#seqColorChannels .seq-ch-end .seq-ch-slider');
    if (endSliders.length > 0) {
      endChannelValues = {};
      endSliders.forEach(sl => {
        endChannelValues[sl.dataset.chType] = +sl.querySelector('input[type="range"]').value;
      });
    }

    if (type === 'strobe') {
      const hzEl = document.querySelector('#seqColorChannels .seq-ch-slider[data-ch-type="strobe_hz"] input[type="range"]');
      if (hzEl) channelValues.strobe_hz = +hzEl.value;
    }

    if (type === 'movement') {
      const presetId = document.getElementById('seqPropMoverPreset').value;
      if (presetId) channelValues.mover_preset_id = +presetId;
    }

    const update = {
      cue_type: type, start_ms: Math.round(startMs), duration_ms: Math.round(durMs),
      label, color, channel_values: channelValues,
      end_channel_values: endChannelValues, effect_id: effectId ? +effectId : null,
    };

    await fetch(`/api/cues/${seqSelectedCueId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update)
    });
    Object.assign(cue, update);
    renderSequencerTimeline();
    updateSelectionVisuals();
  }

  // Apply button
  document.getElementById('seqPropSave').addEventListener('click', applyCurrentCueProperties);

  // Delete cue(s)
  document.getElementById('seqPropDelete').addEventListener('click', () => deleteSelectedCues());

  // Type change — re-render channel sliders without resetting dropdown
  document.getElementById('seqPropType').addEventListener('change', () => {
    if (seqSelectedCueId) {
      const newType = document.getElementById('seqPropType').value;
      updateMoverPresetVisibility(newType);
      renderCueChannelSliders(seqSelectedCueId, newType);
    }
  });

  // Color picker change — update R/G/B channel sliders to match
  document.getElementById('seqPropColor').addEventListener('input', () => {
    const hex = document.getElementById('seqPropColor').value;
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    const mapping = { red: r, green: g, blue: b };
    document.querySelectorAll('#seqColorChannels .seq-ch-start .seq-ch-slider').forEach(sl => {
      const type = sl.dataset.chType;
      if (mapping[type] !== undefined) {
        const input = sl.querySelector('input[type="range"]');
        input.value = mapping[type];
        sl.querySelector('.seq-ch-val').textContent = mapping[type];
      }
    });
  });

  // Click on ruler to set playhead (and seek server + audio)
  document.getElementById('seqRuler').addEventListener('click', (e) => {
    const rect = document.getElementById('seqRuler').getBoundingClientRect();
    const x = e.clientX - rect.left;
    seekSequence(Math.max(0, (x / seqZoomPxPerSec) * 1000));
  });

  // ─── Playhead drag to seek ────────────────────────────────────────────────
  const phEl = document.getElementById('seqPlayhead');
  phEl.addEventListener('mousedown', (e) => {
    if (!seqCurrentSeq) return;
    seqIsDraggingPlayhead = true;
    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!seqIsDraggingPlayhead) return;
    const wrap = document.getElementById('seqTimelineWrap');
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left + wrap.scrollLeft - 140;
    const maxMs = seqCurrentSeq?.duration_ms || Infinity;
    seqPlayheadMs = Math.max(0, Math.min((x / seqZoomPxPerSec) * 1000, maxMs));
    updatePlayhead();
    syncAudioToPlayhead();
  });

  document.addEventListener('mouseup', () => {
    if (!seqIsDraggingPlayhead) return;
    seqIsDraggingPlayhead = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Commit seek to server
    if (seqCurrentId) {
      ws.send(JSON.stringify({ type: 'sequence', action: 'seek', deck: seqDeck, timeMs: seqPlayheadMs }));
    }
  });

  // Effects management
  document.getElementById('seqAddEffectBtn').addEventListener('click', () => openEffectModal(null));
  document.getElementById('effSaveBtn').addEventListener('click', saveEffect);
  document.getElementById('effType').addEventListener('change', (e) => {
    renderEffectParams(e.target.value, {});
    // Auto-set fixture_target based on effect type category
    const movingTypes = ['pan_sweep','tilt_sweep','circle','figure_eight','random_move','fan','nod'];
    const multicellOnlyTypes = ['segments','ripple','cell_strobe','gradient'];
    const colorTypes = ['pulse','rainbow','strobe','color_fade','sparkle','color_wave','fire'];
    const sel = document.getElementById('effFixtureTarget');
    if (movingTypes.includes(e.target.value)) sel.value = 'moving_head';
    else if (multicellOnlyTypes.includes(e.target.value)) sel.value = 'multicell';
    else if (colorTypes.includes(e.target.value)) sel.value = 'color';
    else sel.value = 'all';
  });

  // ─── Keyboard shortcuts: Copy / Paste / Delete / Nudge / Select All ──────
  document.addEventListener('keydown', async (e) => {
    // Ignore when typing in an input / textarea / select
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    // Ctrl+A — select all cues
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      if (!seqCurrentId) return;
      e.preventDefault();
      seqSelectedCueIds.clear();
      for (const c of seqCues) seqSelectedCueIds.add(c.id);
      seqSelectedCueId = seqCues.length > 0 ? seqCues[0].id : null;
      updateSelectionVisuals();
      updateSelectionInfo();
      return;
    }

    // Delete — remove all selected cues
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (seqSelectedCueIds.size === 0) return;
      e.preventDefault();
      await deleteSelectedCues();
      return;
    }

    // Ctrl+C — copy all selected cues
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (seqSelectedCueIds.size === 0) return;
      e.preventDefault();
      seqClipboard = [...seqSelectedCueIds].map(id => {
        const c = seqCues.find(q => q.id === id);
        return c ? JSON.parse(JSON.stringify(c)) : null;
      }).filter(Boolean);
      return;
    }

    // Ctrl+V — paste copied cues at playhead position
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (!seqClipboard || !seqClipboard.length || !seqCurrentId) return;
      e.preventDefault();
      // Calculate offset so earliest cue starts at playhead
      const minStart = Math.min(...seqClipboard.map(c => c.start_ms));
      const offset = Math.round(seqPlayheadMs) - minStart;
      const newIds = [];
      for (const clip of seqClipboard) {
        const body = {
          lane: clip.lane,
          start_ms: Math.max(0, clip.start_ms + offset),
          duration_ms: clip.duration_ms,
          cue_type: clip.cue_type || 'static',
          fixture_id: clip.fixture_id,
          channel_values: clip.channel_values,
          end_channel_values: clip.end_channel_values || null,
          color: clip.color,
          label: clip.label || '',
          effect_id: clip.effect_id || null,
        };
        if (clip.cell) body.cell = clip.cell;
        const res = await fetch(`/api/sequences/${seqCurrentId}/cues`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const newCue = await res.json();
        seqCues.push(newCue);
        newIds.push(newCue.id);
      }
      document.getElementById('seqCueCount').textContent = seqCues.length;
      // Select all pasted cues
      seqSelectedCueIds.clear();
      newIds.forEach(id => seqSelectedCueIds.add(id));
      seqSelectedCueId = newIds[0] || null;
      renderSequencerTimeline();
      updateSelectionVisuals();
      updateSelectionInfo();
      return;
    }

    // Escape — deselect all
    if (e.key === 'Escape') {
      clearCueSelection();
      return;
    }

    // Left / Right arrow — nudge all selected cues
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (seqSelectedCueIds.size === 0) return;
      e.preventDefault();

      let nudgeMs;
      if (seqSnapBeats && seqCurrentSeq?.bpm) {
        const beatMs = 60000 / seqCurrentSeq.bpm;
        nudgeMs = beatMs * seqSnapBeats;
      } else {
        nudgeMs = 10;
      }
      if (e.shiftKey) nudgeMs = Math.max(10, nudgeMs / 4);
      const dir = e.key === 'ArrowRight' ? 1 : -1;

      const updates = [];
      for (const sid of seqSelectedCueIds) {
        const cue = seqCues.find(c => c.id === sid);
        if (!cue) continue;
        cue.start_ms = Math.max(0, Math.round(cue.start_ms + dir * nudgeMs));
        updates.push(fetch(`/api/cues/${cue.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_ms: cue.start_ms })
        }));
      }
      await Promise.all(updates);
      renderSequencerTimeline();
      updateSelectionVisuals();
      return;
    }
  });
}

// ─── Cue Selection & Properties ──────────────────────────────────────────────

async function deleteSelectedCues() {
  if (seqSelectedCueIds.size === 0) return;
  const ids = [...seqSelectedCueIds];
  await Promise.all(ids.map(id => fetch(`/api/cues/${id}`, { method: 'DELETE' })));
  seqCues = seqCues.filter(c => !seqSelectedCueIds.has(c.id));
  clearCueSelection();
  document.getElementById('seqCueCount').textContent = seqCues.length;
  renderSequencerTimeline();
}

// Backwards compat alias
async function deleteSelectedCue() { return deleteSelectedCues(); }

function autoApplyCurrentCue() {
  // Silently save the current cue properties without re-rendering
  if (!seqSelectedCueId) return;
  const cue = seqCues.find(c => c.id === seqSelectedCueId);
  if (!cue) return;

  const type = document.getElementById('seqPropType').value;
  const startMs = parseFloat(document.getElementById('seqPropStart').value) * 1000;
  const durMs = parseFloat(document.getElementById('seqPropDur').value) * 1000;
  const label = document.getElementById('seqPropLabel').value;
  const effectId = document.getElementById('seqPropEffect').value || null;

  const channelValues = {};
  document.querySelectorAll('#seqColorChannels .seq-ch-start .seq-ch-slider').forEach(sl => {
    channelValues[sl.dataset.chType] = +sl.querySelector('input[type="range"]').value;
  });

  const color = (channelValues.red !== undefined || channelValues.green !== undefined || channelValues.blue !== undefined)
    ? colorFromChannelValues(channelValues)
    : document.getElementById('seqPropColor').value;

  let endChannelValues = null;
  const endSliders = document.querySelectorAll('#seqColorChannels .seq-ch-end .seq-ch-slider');
  if (endSliders.length > 0) {
    endChannelValues = {};
    endSliders.forEach(sl => {
      endChannelValues[sl.dataset.chType] = +sl.querySelector('input[type="range"]').value;
    });
  }

  if (type === 'strobe') {
    const hzEl = document.querySelector('#seqColorChannels .seq-ch-slider[data-ch-type="strobe_hz"] input[type="range"]');
    if (hzEl) channelValues.strobe_hz = +hzEl.value;
  }

  const update = {
    cue_type: type, start_ms: Math.round(startMs), duration_ms: Math.round(durMs),
    label, color, channel_values: channelValues,
    end_channel_values: endChannelValues, effect_id: effectId ? +effectId : null,
  };

  // Fire-and-forget save
  fetch(`/api/cues/${seqSelectedCueId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  });
  Object.assign(cue, update);
}

function clearCueSelection() {
  seqSelectedCueIds.clear();
  seqSelectedCueId = null;
  document.querySelectorAll('.seq-cue.selected').forEach(el => el.classList.remove('selected'));
  document.getElementById('seqProperties').classList.remove('open');
  // Ensure keyboard shortcuts work
  if (document.activeElement && document.activeElement.tagName.match(/INPUT|TEXTAREA|SELECT/i)) {
    document.activeElement.blur();
  }
}

function updateSelectionVisuals() {
  document.querySelectorAll('.seq-cue').forEach(el => {
    el.classList.toggle('selected', seqSelectedCueIds.has(+el.dataset.cueId));
  });
}

function updateSelectionInfo() {
  // Open properties panel for primary selected cue
  if (seqSelectedCueId) {
    const cue = seqCues.find(c => c.id === seqSelectedCueId);
    if (cue) showCueProperties(cue);
  } else {
    document.getElementById('seqProperties').classList.remove('open');
  }
  // Ensure keyboard shortcuts work
  if (document.activeElement && document.activeElement.tagName.match(/INPUT|TEXTAREA|SELECT/i)) {
    document.activeElement.blur();
  }
}

function selectCue(cueId) {
  // Auto-apply changes to previous cue before switching
  if (seqSelectedCueId && seqSelectedCueId !== cueId && document.getElementById('seqProperties').classList.contains('open')) {
    autoApplyCurrentCue();
  }
  // Single-select: clear others, set this one
  seqSelectedCueIds.clear();
  seqSelectedCueIds.add(cueId);
  seqSelectedCueId = cueId;
  updateSelectionVisuals();

  // Ensure keyboard shortcuts work by moving focus away from any input
  if (document.activeElement && document.activeElement.tagName.match(/INPUT|TEXTAREA|SELECT/i)) {
    document.activeElement.blur();
  }

  const cue = seqCues.find(c => c.id === cueId);
  if (!cue) { document.getElementById('seqProperties').classList.remove('open'); return; }
  showCueProperties(cue);
}

function showCueProperties(cue) {
  const propsEl = document.getElementById('seqProperties');
  propsEl.classList.add('open');

  const cueType = cue.cue_type || 'solid';

  document.getElementById('seqPropType').value = cueType;
  document.getElementById('seqPropStart').value = (cue.start_ms / 1000).toFixed(3);
  document.getElementById('seqPropDur').value = (cue.duration_ms / 1000).toFixed(3);
  document.getElementById('seqPropLabel').value = cue.label || '';
  // Derive color from RGB channel values if available
  const chV = cue.channel_values || {};
  if (chV.red !== undefined || chV.green !== undefined || chV.blue !== undefined) {
    document.getElementById('seqPropColor').value = colorFromChannelValues(chV);
  } else {
    document.getElementById('seqPropColor').value = cue.color || '#e94560';
  }
  document.getElementById('seqPropEffect').value = cue.effect_id || '';

  // Show/hide mover preset dropdown based on cue type
  updateMoverPresetVisibility(cueType);
  if (cueType === 'movement') {
    const chV2 = cue.channel_values || {};
    document.getElementById('seqPropMoverPreset').value = chV2.mover_preset_id || '';
  }

  // Build channel sliders based on stored type
  renderCueChannelSliders(cue.id, cueType);
}

// ─── Color Helpers ───────────────────────────────────────────────────────────

function colorFromChannelValues(chVals) {
  const r = chVals.red !== undefined ? chVals.red : 0;
  const g = chVals.green !== undefined ? chVals.green : 0;
  const b = chVals.blue !== undefined ? chVals.blue : 0;
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function copyStartToEnd() {
  const startSliders = document.querySelectorAll('#seqColorChannels .seq-ch-start .seq-ch-slider');
  startSliders.forEach(sl => {
    const chType = sl.dataset.chType;
    const val = sl.querySelector('input[type="range"]').value;
    const endSl = document.querySelector(`#seqColorChannels .seq-ch-end .seq-ch-slider[data-ch-type="${chType}"]`);
    if (endSl) {
      endSl.querySelector('input[type="range"]').value = val;
      endSl.querySelector('.seq-ch-val').textContent = val;
    }
  });
}

function updateCueColorFromSliders() {
  const sliders = document.querySelectorAll('#seqColorChannels .seq-ch-start .seq-ch-slider');
  const vals = {};
  sliders.forEach(sl => { vals[sl.dataset.chType] = +sl.querySelector('input[type="range"]').value; });
  if (vals.red !== undefined || vals.green !== undefined || vals.blue !== undefined) {
    document.getElementById('seqPropColor').value = colorFromChannelValues(vals);
  }
}

// ─── Channel Sliders ─────────────────────────────────────────────────────────

function renderCueChannelSliders(cueId, cueType) {
  const cue = seqCues.find(c => c.id === cueId);
  if (!cue) return;

  const fix = seqFixtures.find(f => f.id === cue.fixture_id);
  const chContainer = document.getElementById('seqColorChannels');
  const chVals = cue.channel_values || {};

  if (!fix) { chContainer.innerHTML = '<div style="color:var(--text-dim);font-size:11px">No fixture assigned</div>'; return; }

  // Filter channels by cell when cue targets a specific cell
  let channels = fix.channels;
  if (cue.cell) {
    channels = fix.channels.filter(ch => !ch.cell || ch.cell === cue.cell);
  }

  // For movers, filter channels based on cue type (light vs movement)
  const moverMoveTypes = new Set(['pan', 'tilt', 'gobo', 'gobo_rotation', 'speed']);
  const isMoverFixture = fix.channels.some(c => c.type === 'pan') && fix.channels.some(c => c.type === 'tilt');
  if (isMoverFixture && cue.label === 'move') {
    channels = channels.filter(ch => moverMoveTypes.has(ch.type));
  } else if (isMoverFixture && seqExpandedFixtures.has(fix.id) && cue.label !== 'move') {
    channels = channels.filter(ch => !moverMoveTypes.has(ch.type));
  }

  const chColorMap = {
    red: '#f44', green: '#4f4', blue: '#44f', white: '#fff',
    dimmer: '#ff0', amber: '#fa0', uv: '#a0f',
  };

  let html = '<div class="seq-ch-start" style="margin-bottom:6px"><div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">' +
    (cueType === 'solid' ? 'COLOR' : 'START VALUES') + '</div><div style="display:flex;gap:12px;flex-wrap:wrap">';
  for (const ch of channels) {
    const val = chVals[ch.type] !== undefined ? chVals[ch.type] : 0;
    const color = chColorMap[ch.type] || '#888';
    html += `<div class="seq-ch-slider" data-ch-type="${ch.type}">` +
      `<label style="color:${color}">${ch.type.substring(0, 4).toUpperCase()}</label>` +
      `<input type="range" min="0" max="255" value="${val}" oninput="this.nextElementSibling.textContent=this.value;updateCueColorFromSliders()">` +
      `<span class="seq-ch-val">${val}</span></div>`;
  }
  html += '</div></div>';

  // End values — only shown for transition types (not solid/effect)
  const showEndValues = cueType === 'static' || cueType === 'chase';
  if (showEndValues) {
    const endVals = cue.end_channel_values || {};
    const hasEnd = Object.keys(endVals).length > 0;
    html += '<div class="seq-ch-end" style="margin-bottom:6px"><div style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text-dim);margin-bottom:4px">' +
      '<span>END VALUES</span>' +
      '<button type="button" class="btn btn-sm" style="font-size:9px;padding:1px 6px" onclick="copyStartToEnd()">Copy Start→End</button>' +
      '</div><div style="display:flex;gap:12px;flex-wrap:wrap">';
    for (const ch of channels) {
      const val = hasEnd && endVals[ch.type] !== undefined ? endVals[ch.type] : (chVals[ch.type] !== undefined ? chVals[ch.type] : 0);
      const color = chColorMap[ch.type] || '#888';
      html += `<div class="seq-ch-slider" data-ch-type="${ch.type}">` +
        `<label style="color:${color}">${ch.type.substring(0, 4).toUpperCase()}</label>` +
        `<input type="range" min="0" max="255" value="${val}" oninput="this.nextElementSibling.textContent=this.value">` +
        `<span class="seq-ch-val">${val}</span></div>`;
    }
    html += '</div></div>';
  }

  if (cueType === 'strobe') {
    const hz = chVals.strobe_hz || 10;
    html += '<div style="margin-top:6px"><div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">STROBE RATE</div>' +
      `<div class="seq-ch-slider" data-ch-type="strobe_hz"><label>Hz</label>` +
      `<input type="range" min="1" max="30" value="${hz}" oninput="this.nextElementSibling.textContent=this.value">` +
      `<span class="seq-ch-val">${hz}</span></div></div>`;
  }

  if (cueType === 'effect') {
    html += '<div style="margin-top:6px;font-size:11px;color:var(--text-dim)">Effect parameters are controlled by the selected effect above.</div>';
  }

  if (cueType === 'movement') {
    const presetId = chVals.mover_preset_id;
    const preset = presetId ? seqMoverPresets.find(p => p.id === presetId) : null;
    html += '<div style="margin-top:6px;font-size:11px;color:var(--text-dim)">' +
      'Select a Movement Preset above. The fixture will cycle through the preset positions over the cue duration.' +
      (preset ? `<div style="margin-top:4px;color:var(--cyan)">Preset: <strong>${esc(preset.name)}</strong> (${preset.positions.length} positions)</div>` : '') +
      '</div>';
  }

  chContainer.innerHTML = html;
}

// ─── Fixture Picker ──────────────────────────────────────────────────────────

function renderFixturePicker() {
  const picker = document.getElementById('seqFixturePicker');
  const grid = document.getElementById('seqFixGrid');
  if (!seqCurrentSeq) { picker.style.display = 'none'; return; }
  picker.style.display = 'block';

  let html = '';
  for (const fix of seqFixtures) {
    const active = seqActiveLanes.has(fix.id) ? ' active' : '';
    const hasRGB = fix.channels.some(c => c.type === 'red');
    html += `<div class="seq-fix-chip${active}" data-fix-id="${fix.id}">` +
      `${hasRGB ? '&#127912; ' : '&#9881; '}${esc(fix.name)}</div>`;
  }
  if (seqFixtures.length === 0) {
    html = '<div style="color:var(--text-dim);font-size:11px">No fixtures configured. Add fixtures in the Fixtures tab first.</div>';
  }
  grid.innerHTML = html;

  // Click handlers
  grid.querySelectorAll('.seq-fix-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const fixId = +chip.dataset.fixId;
      if (seqActiveLanes.has(fixId)) {
        const hasCues = seqCues.some(c => c.fixture_id === fixId);
        if (hasCues) {
          alert('Cannot remove — this fixture has cues in the sequence. Delete the cues first.');
          return;
        }
        seqActiveLanes.delete(fixId);
        chip.classList.remove('active');
      } else {
        seqActiveLanes.add(fixId);
        chip.classList.add('active');
      }
      renderSequencerTimeline();
    });
  });
}

// ─── Effects Library ─────────────────────────────────────────────────────────

function renderEffectsList() {
  const list = document.getElementById('seqEffectsList');
  if (seqEffects.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px">No effects yet. Click "+ New Effect" to create one.</div>';
    return;
  }
  let html = '';
  const TARGET_BADGE = { all: '', color: '🎨', moving_head: '🔦', multicell: '▓' };
  for (const eff of seqEffects) {
    const badge = TARGET_BADGE[eff.fixture_target] || '';
    html += `<div class="seq-effect-card" data-eff-id="${eff.id}">` +
      `<span class="eff-type ${eff.type}">${eff.type.replace('_', ' ')}</span>` +
      (badge ? `<span style="font-size:10px" title="${(eff.fixture_target||'all').replace('_',' ')}">${badge}</span>` : '') +
      `<span class="eff-name">${esc(eff.name)}</span>` +
      `<span style="font-size:9px;color:var(--text-dim)">${eff.duration_beats}b</span>` +
      `<span class="eff-actions">` +
      `<button onclick="editEffect(${eff.id})" title="Edit">&#9998;</button>` +
      `<button onclick="deleteEffect(${eff.id})" title="Delete" style="color:var(--danger)">&#10006;</button>` +
      `</span></div>`;
  }
  list.innerHTML = html;
}

function openEffectModal(eff) {
  seqEditingEffectId = eff ? eff.id : null;
  document.getElementById('effectModalTitle').textContent = eff ? 'Edit Effect' : 'New Effect';
  document.getElementById('effName').value = eff ? eff.name : '';
  document.getElementById('effType').value = eff ? eff.type : 'pulse';
  document.getElementById('effCategory').value = eff ? (eff.category || 'color') : 'color';
  document.getElementById('effFixtureTarget').value = eff ? (eff.fixture_target || 'all') : 'all';
  document.getElementById('effDurBeats').value = eff ? eff.duration_beats : 4;
  renderEffectParams(eff ? eff.type : 'pulse', eff ? eff.effect_data : {});
  document.getElementById('effectModal').classList.add('open');
}

function renderEffectParams(type, data) {
  const area = document.getElementById('effParamsArea');
  let html = '';

  // Shared channels-per-cell row for cell-aware effects
  const cellRow = (d) => `<div class="form-group"><label>Channels per Cell</label>` +
    `<input type="number" id="effParamCpp" value="${d.channels_per_cell || 3}" min="1" max="20" step="1"></div>`;

  if (type === 'pulse') {
    const freq = data.frequency || 1;
    html = `<div class="form-group"><label>Frequency (cycles per duration)</label>` +
      `<input type="number" id="effParamFreq" value="${freq}" min="0.1" step="0.1"></div>`;
  } else if (type === 'rainbow') {
    const cycles = data.cycles || 1;
    html = `<div class="form-group"><label>Hue Cycles</label>` +
      `<input type="number" id="effParamCycles" value="${cycles}" min="0.25" step="0.25"></div>`;
  } else if (type === 'strobe') {
    const freq = data.frequency || 10;
    html = `<div class="form-group"><label>Strobe Frequency (Hz)</label>` +
      `<input type="number" id="effParamFreq" value="${freq}" min="1" max="50" step="1"></div>`;
  } else if (type === 'color_fade') {
    const sc = data.start_color || { red: 255, green: 0, blue: 0 };
    const ec = data.end_color || { red: 0, green: 0, blue: 255 };
    const startHex = '#' + [sc.red, sc.green, sc.blue].map(v => (v||0).toString(16).padStart(2,'0')).join('');
    const endHex = '#' + [ec.red, ec.green, ec.blue].map(v => (v||0).toString(16).padStart(2,'0')).join('');
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Start Color</label><input type="color" id="effParamStartColor" value="${startHex}"></div>` +
      `<div class="form-group"><label>End Color</label><input type="color" id="effParamEndColor" value="${endHex}"></div></div>`;
  } else if (type === 'chase') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Direction</label><select id="effParamDir">` +
        `<option value="left" ${data.direction==='left'?'selected':''}>Left → Right</option>` +
        `<option value="right" ${data.direction==='right'?'selected':''}>Right → Left</option>` +
        `<option value="bounce" ${data.direction==='bounce'?'selected':''}>Bounce</option>` +
        `<option value="center" ${data.direction==='center'?'selected':''}>Center Out</option>` +
        `<option value="outside" ${data.direction==='outside'?'selected':''}>Outside In</option>` +
      `</select></div>` +
      `<div class="form-group"><label>Speed (cycles)</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row">` +
      `<div class="form-group"><label>Width (cells)</label>` +
        `<input type="number" id="effParamWidth" value="${data.width||3}" min="1" max="50" step="1"></div>` +
      `<div class="form-group"><label>Tail (cells)</label>` +
        `<input type="number" id="effParamTail" value="${data.tail||0}" min="0" max="50" step="1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'comet') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Direction</label><select id="effParamDir">` +
        `<option value="left" ${data.direction==='left'?'selected':''}>Left → Right</option>` +
        `<option value="right" ${data.direction==='right'?'selected':''}>Right → Left</option>` +
      `</select></div>` +
      `<div class="form-group"><label>Speed (cycles)</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row">` +
      `<div class="form-group"><label>Tail Length (cells)</label>` +
        `<input type="number" id="effParamTail" value="${data.tail||10}" min="1" max="50" step="1"></div>` +
      `${cellRow(data)}</div>`;
  } else if (type === 'scanner') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Speed (cycles)</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div>` +
      `<div class="form-group"><label>Width (cells)</label>` +
        `<input type="number" id="effParamWidth" value="${data.width||1}" min="1" max="50" step="1"></div></div>` +
      `<div class="form-row">` +
      `<div class="form-group"><label>Tail (cells)</label>` +
        `<input type="number" id="effParamTail" value="${data.tail||5}" min="0" max="50" step="1"></div>` +
      `${cellRow(data)}</div>`;
  } else if (type === 'sparkle') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Density (0-1)</label>` +
        `<input type="number" id="effParamDensity" value="${data.density||0.1}" min="0.01" max="1" step="0.01"></div>` +
      `<div class="form-group"><label>Fade Speed</label>` +
        `<input type="number" id="effParamFadeSpd" value="${data.fade_speed||6}" min="1" max="20" step="1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'color_wave') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Wavelength (cells)</label>` +
        `<input type="number" id="effParamWavelength" value="${data.wavelength||20}" min="2" max="200" step="1"></div>` +
      `<div class="form-group"><label>Speed (cycles)</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'fire') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Intensity (0-1)</label>` +
        `<input type="number" id="effParamIntensity" value="${data.intensity||0.8}" min="0.1" max="1" step="0.05"></div>` +
      `<div class="form-group"><label>Cooling (0-1)</label>` +
        `<input type="number" id="effParamCooling" value="${data.cooling||0.3}" min="0" max="1" step="0.05"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'buildup') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Direction</label><select id="effParamDir">` +
        `<option value="left" ${data.direction==='left'?'selected':''}>Left → Right</option>` +
        `<option value="right" ${data.direction==='right'?'selected':''}>Right → Left</option>` +
        `<option value="center" ${data.direction==='center'?'selected':''}>Center Out</option>` +
      `</select></div>` +
      `${cellRow(data)}</div>`;
  // ── Moving Head effects ─────────────────────────────────────────────
  } else if (type === 'pan_sweep' || type === 'tilt_sweep') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Speed (cycles)</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div>` +
      `<div class="form-group"><label>Range (0-1)</label>` +
        `<input type="number" id="effParamRange" value="${data.range||1}" min="0.05" max="1" step="0.05"></div></div>`;
  } else if (type === 'circle' || type === 'figure_eight') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Speed (cycles)</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div>` +
      `<div class="form-group"><label>Size (0-1)</label>` +
        `<input type="number" id="effParamSize" value="${data.size||0.5}" min="0.05" max="1" step="0.05"></div></div>`;
  } else if (type === 'random_move') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Speed</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="form-group"><label>Range (0-1)</label>` +
        `<input type="number" id="effParamRange" value="${data.range||0.5}" min="0.05" max="1" step="0.05"></div></div>` +
      `<div class="form-row">` +
      `<div class="form-group"><label>Smoothing (0-1)</label>` +
        `<input type="number" id="effParamSmoothing" value="${data.smoothing||0.3}" min="0" max="1" step="0.05"></div></div>`;
  } else if (type === 'fan') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Speed</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||0.5}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="form-group"><label>Spread (0-1)</label>` +
        `<input type="number" id="effParamSpread" value="${data.spread||1}" min="0.1" max="1" step="0.05"></div></div>`;
  } else if (type === 'nod') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Axis</label><select id="effParamAxis">` +
        `<option value="tilt" ${(data.axis||'tilt')==='tilt'?'selected':''}>Tilt (Nod)</option>` +
        `<option value="pan" ${data.axis==='pan'?'selected':''}>Pan (Shake)</option>` +
      `</select></div>` +
      `<div class="form-group"><label>Speed</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||2}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row">` +
      `<div class="form-group"><label>Range (0-1)</label>` +
        `<input type="number" id="effParamRange" value="${data.range||0.3}" min="0.05" max="1" step="0.05"></div></div>`;
  // ── Multicell-specific effects ──────────────────────────────────────
  } else if (type === 'segments') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Segment Size (cells)</label>` +
        `<input type="number" id="effParamSegSize" value="${data.segment_size||2}" min="1" max="20" step="1"></div>` +
      `<div class="form-group"><label>Offset Speed</label>` +
        `<input type="number" id="effParamSpeed" value="${data.offset_speed||1}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'ripple') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Speed</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="form-group"><label>Width (cells)</label>` +
        `<input type="number" id="effParamWidth" value="${data.width||3}" min="1" max="20" step="1"></div></div>` +
      `<div class="form-row">` +
      `<div class="form-group"><label>Decay (0-1)</label>` +
        `<input type="number" id="effParamDecay" value="${data.decay||0.7}" min="0.1" max="1" step="0.05"></div>` +
      `${cellRow(data)}</div>`;
  } else if (type === 'cell_strobe') {
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Frequency (Hz)</label>` +
        `<input type="number" id="effParamFreq" value="${data.frequency||8}" min="1" max="30" step="1"></div>` +
      `<div class="form-group"><label>Pattern</label><select id="effParamPattern">` +
        `<option value="sequential" ${(data.pattern||'sequential')==='sequential'?'selected':''}>Sequential</option>` +
        `<option value="random" ${data.pattern==='random'?'selected':''}>Random</option>` +
      `</select></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'gradient') {
    const colors = data.colors || ['#ff0000', '#0000ff'];
    html = `<div class="form-row">` +
      `<div class="form-group"><label>Speed</label>` +
        `<input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div>` +
      `</div>` +
      `<div class="form-row">` +
      `<div class="form-group"><label>Color 1</label><input type="color" id="effParamGradC1" value="${colors[0]||'#ff0000'}"></div>` +
      `<div class="form-group"><label>Color 2</label><input type="color" id="effParamGradC2" value="${colors[1]||'#0000ff'}"></div>` +
      `<div class="form-group"><label>Color 3 (opt)</label><input type="color" id="effParamGradC3" value="${colors[2]||'#000000'}"></div></div>` +
      `<div class="form-row"><div class="form-group"><label><input type="checkbox" id="effParamGradC3On" ${colors.length>=3?'checked':''}> Use 3rd color</label></div>` +
      `${cellRow(data)}</div>`;
  }
  area.innerHTML = html;
}

function getEffectDataFromForm(type) {
  if (type === 'pulse') {
    return { frequency: +(document.getElementById('effParamFreq')?.value || 1) };
  } else if (type === 'rainbow') {
    return { cycles: +(document.getElementById('effParamCycles')?.value || 1) };
  } else if (type === 'strobe') {
    return { frequency: +(document.getElementById('effParamFreq')?.value || 10) };
  } else if (type === 'color_fade') {
    const startHex = document.getElementById('effParamStartColor')?.value || '#ff0000';
    const endHex = document.getElementById('effParamEndColor')?.value || '#0000ff';
    const hexToRgb = (h) => ({ red: parseInt(h.slice(1,3),16), green: parseInt(h.slice(3,5),16), blue: parseInt(h.slice(5,7),16) });
    return { start_color: hexToRgb(startHex), end_color: hexToRgb(endHex) };
  } else if (type === 'chase') {
    return {
      direction: document.getElementById('effParamDir')?.value || 'left',
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      width: +(document.getElementById('effParamWidth')?.value || 3),
      tail: +(document.getElementById('effParamTail')?.value || 0),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'comet') {
    return {
      direction: document.getElementById('effParamDir')?.value || 'left',
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      tail: +(document.getElementById('effParamTail')?.value || 10),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'scanner') {
    return {
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      width: +(document.getElementById('effParamWidth')?.value || 1),
      tail: +(document.getElementById('effParamTail')?.value || 5),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'sparkle') {
    return {
      density: +(document.getElementById('effParamDensity')?.value || 0.1),
      fade_speed: +(document.getElementById('effParamFadeSpd')?.value || 6),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'color_wave') {
    return {
      wavelength: +(document.getElementById('effParamWavelength')?.value || 20),
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'fire') {
    return {
      intensity: +(document.getElementById('effParamIntensity')?.value || 0.8),
      cooling: +(document.getElementById('effParamCooling')?.value || 0.3),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'buildup') {
    return {
      direction: document.getElementById('effParamDir')?.value || 'left',
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  // Moving head effects
  } else if (type === 'pan_sweep' || type === 'tilt_sweep') {
    return {
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      range: +(document.getElementById('effParamRange')?.value || 1),
    };
  } else if (type === 'circle' || type === 'figure_eight') {
    return {
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      size: +(document.getElementById('effParamSize')?.value || 0.5),
    };
  } else if (type === 'random_move') {
    return {
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      range: +(document.getElementById('effParamRange')?.value || 0.5),
      smoothing: +(document.getElementById('effParamSmoothing')?.value || 0.3),
    };
  } else if (type === 'fan') {
    return {
      speed: +(document.getElementById('effParamSpeed')?.value || 0.5),
      spread: +(document.getElementById('effParamSpread')?.value || 1),
    };
  } else if (type === 'nod') {
    return {
      axis: document.getElementById('effParamAxis')?.value || 'tilt',
      speed: +(document.getElementById('effParamSpeed')?.value || 2),
      range: +(document.getElementById('effParamRange')?.value || 0.3),
    };
  // Multicell effects
  } else if (type === 'segments') {
    return {
      segment_size: +(document.getElementById('effParamSegSize')?.value || 2),
      offset_speed: +(document.getElementById('effParamSpeed')?.value || 1),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'ripple') {
    return {
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      width: +(document.getElementById('effParamWidth')?.value || 3),
      decay: +(document.getElementById('effParamDecay')?.value || 0.7),
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'cell_strobe') {
    return {
      frequency: +(document.getElementById('effParamFreq')?.value || 8),
      pattern: document.getElementById('effParamPattern')?.value || 'sequential',
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  } else if (type === 'gradient') {
    const colors = [
      document.getElementById('effParamGradC1')?.value || '#ff0000',
      document.getElementById('effParamGradC2')?.value || '#0000ff',
    ];
    if (document.getElementById('effParamGradC3On')?.checked) {
      colors.push(document.getElementById('effParamGradC3')?.value || '#00ff00');
    }
    return {
      speed: +(document.getElementById('effParamSpeed')?.value || 1),
      colors,
      channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3),
    };
  }
  return {};
}

async function saveEffect() {
  const name = document.getElementById('effName').value.trim();
  if (!name) { alert('Name is required'); return; }
  const type = document.getElementById('effType').value;
  const category = document.getElementById('effCategory').value;
  const fixture_target = document.getElementById('effFixtureTarget').value;
  const duration_beats = +(document.getElementById('effDurBeats').value || 4);
  const effect_data = getEffectDataFromForm(type);

  const body = { name, type, category, fixture_target, effect_data, duration_beats };
  let result;
  if (seqEditingEffectId) {
    const res = await fetch(`/api/effects/${seqEditingEffectId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    result = await res.json();
    const idx = seqEffects.findIndex(e => e.id === seqEditingEffectId);
    if (idx >= 0) seqEffects[idx] = result;
  } else {
    const res = await fetch('/api/effects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    result = await res.json();
    seqEffects.push(result);
  }

  document.getElementById('effectModal').classList.remove('open');
  renderEffectsList();
  refreshEffectDropdown();
}

async function editEffect(id) {
  const eff = seqEffects.find(e => e.id === id);
  if (eff) openEffectModal(eff);
}

async function deleteEffect(id) {
  if (!confirm('Delete this effect?')) return;
  await fetch(`/api/effects/${id}`, { method: 'DELETE' });
  seqEffects = seqEffects.filter(e => e.id !== id);
  renderEffectsList();
  refreshEffectDropdown();
}

// ─── WebSocket Message Handlers ──────────────────────────────────────────────

function handleSeqWsMessage(msg) {
  if (msg.type === 'seq_loaded') {
    if (msg.deck === seqDeck && msg.sequence) {
      // Auto-load the sequence into the editor if it matches our deck
      if (!seqCurrentSeq || seqCurrentSeq.id !== msg.sequence.id) {
        const sel = document.getElementById('seqSelector');
        if (sel) sel.value = msg.sequence.id;
        loadSequenceById(msg.sequence.id);
      }
    }
  } else if (msg.type === 'seq_unloaded') {
    if (msg.deck === seqDeck) {
      seqIsPlaying = false;
      document.getElementById('seqPlayBtn').classList.remove('active');
    }
  } else if (msg.type === 'seq_playing') {
    if (msg.deck === seqDeck) {
      seqIsPlaying = msg.playing;
      document.getElementById('seqPlayBtn').classList.toggle('active', msg.playing);
    }
  }
}

function handleSeqTimeUpdate(msg) {
  if (msg.deck === seqDeck && seqIsPlaying && seqCurrentSeq && !seqIsDraggingPlayhead) {
    seqPlayheadMs = msg.timeMs;
    updatePlayhead();
    // Auto-scroll to keep playhead visible
    const wrap = document.getElementById('seqTimelineWrap');
    if (wrap) {
      const phX = (seqPlayheadMs / 1000) * seqZoomPxPerSec + 140;
      const scrollLeft = wrap.scrollLeft;
      const viewWidth = wrap.clientWidth;
      if (phX < scrollLeft + 140 || phX > scrollLeft + viewWidth - 40) {
        wrap.scrollLeft = Math.max(0, phX - viewWidth / 2);
      }
    }
  }
}

function updateSeqPlayhead(deckNum, timeMs) {
  if (deckNum === seqDeck && seqCurrentSeq && seqIsPlaying && !seqIsDraggingPlayhead) {
    seqPlayheadMs = timeMs;
    updatePlayhead();
    // Auto-scroll to keep playhead visible
    const wrap = document.getElementById('seqTimelineWrap');
    if (wrap) {
      const phX = (seqPlayheadMs / 1000) * seqZoomPxPerSec + 140;
      const scrollLeft = wrap.scrollLeft;
      const viewWidth = wrap.clientWidth;
      if (phX < scrollLeft + 140 || phX > scrollLeft + viewWidth - 40) {
        wrap.scrollLeft = Math.max(0, phX - viewWidth / 2);
      }
    }
  }
}

// ─── Track Integration ───────────────────────────────────────────────────────
// generateTrackSequence is defined in sequencer.html (inline script)

function openSequenceInEditor(seqId) {
  seqCurrentId = seqId;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="sequencer"]').classList.add('active');
  document.getElementById('page-sequencer').classList.add('active');
  loadSequencer();
}
