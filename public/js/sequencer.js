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
let seqZoomPxPerSec = 50;
let seqSnapBeats = 4;
let seqSelectedCueId = null;
let seqDeck = 1;
let seqPlayheadMs = 0;
let seqIsPlaying = false;
let seqDragState = null;
let seqEditingEffectId = null;

async function loadSequencer() {
  if (!seqLoaded) {
    seqLoaded = true;
    setupSequencerEvents();
  }
  const [seqRes, fixRes, effRes] = await Promise.all([
    fetch('/api/sequences').then(r => r.json()),
    fetch('/api/fixture-channel-map').then(r => r.json()),
    fetch('/api/effects').then(r => r.json()),
  ]);
  seqSequences = seqRes;
  seqFixtures = fixRes;
  seqEffects = effRes;

  refreshEffectDropdown();
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
    wfAnalysisData = null;
    wfWaveformData = null;
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
    const fixCues = seqCues.filter(c => c.fixture_id === fix.id);

    let cuesHtml = '';
    for (const cue of fixCues) {
      const left = (cue.start_ms / 1000) * seqZoomPxPerSec;
      const width = Math.max(4, (cue.duration_ms / 1000) * seqZoomPxPerSec);
      const selected = cue.id === seqSelectedCueId ? ' selected' : '';
      const chV = cue.channel_values || {};
      const endV = cue.end_channel_values || {};
      const startColor = (chV.red !== undefined || chV.green !== undefined || chV.blue !== undefined)
        ? colorFromChannelValues(chV) : (cue.color || '#e94560');
      const hasEndRGB = endV.red !== undefined || endV.green !== undefined || endV.blue !== undefined;
      let bgStyle;
      if (hasEndRGB) {
        const endColor = colorFromChannelValues(endV);
        bgStyle = `background:linear-gradient(to right, ${startColor}, ${endColor})`;
      } else {
        bgStyle = `background:${startColor}`;
      }
      cuesHtml += `<div class="seq-cue${selected}" data-cue-id="${cue.id}" ` +
        `style="left:${left}px;width:${width}px;${bgStyle}" ` +
        `title="${esc(cue.label || cue.cue_type)} (${(cue.start_ms/1000).toFixed(2)}s - ${(cue.duration_ms/1000).toFixed(2)}s)">` +
        `${esc(cue.label || cue.cue_type)}<div class="seq-cue-resize"></div></div>`;
    }

    // Grid lines
    let gridHtml = '';
    let gt = 0; beatCount = 0;
    while (gt < durationMs) {
      const gx = (gt / 1000) * seqZoomPxPerSec;
      const isBar = beatCount % 4 === 0;
      gridHtml += `<div class="seq-grid-line ${isBar ? 'bar' : 'beat'}" style="left:${gx}px"></div>`;
      beatCount++;
      gt += beatMs;
    }

    const hasRGB = fix.channels.some(c => c.type === 'red');
    lanesHtml += `<div class="seq-lane" data-fixture-id="${fix.id}" data-lane="${i}">` +
      `<div class="seq-lane-header">` +
      `<div class="seq-lh-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
      `<span>${esc(fix.name)}</span></div>` +
      `<div class="seq-lane-track" data-fixture-id="${fix.id}">${gridHtml}${cuesHtml}</div></div>`;
  }
  lanesWrap.innerHTML = lanesHtml;

  // Draw waveform on the canvas (defer to next frame so DOM is laid out)
  if (wfAnalysisData && wfWaveformData && typeof drawTimelineWaveform === 'function') {
    requestAnimationFrame(() => drawTimelineWaveform());
  }

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
  });
  document.getElementById('seqPauseBtn').addEventListener('click', () => {
    seqIsPlaying = false;
    document.getElementById('seqPlayBtn').classList.remove('active');
    ws.send(JSON.stringify({ type: 'sequence', action: 'pause', deck: seqDeck }));
  });
  document.getElementById('seqStopBtn').addEventListener('click', () => {
    seqIsPlaying = false;
    seqPlayheadMs = 0;
    document.getElementById('seqPlayBtn').classList.remove('active');
    updatePlayhead();
    ws.send(JSON.stringify({ type: 'sequence', action: 'unload', deck: seqDeck }));
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

    const res = await fetch(`/api/sequences/${seqCurrentId}/cues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs),
        cue_type: 'static', fixture_id: fixtureId,
        channel_values: { red: 255, green: 0, blue: 0 },
        color: '#ff0000', label: '',
      })
    });
    const cue = await res.json();
    seqCues.push(cue);
    document.getElementById('seqCueCount').textContent = seqCues.length;
    renderSequencerTimeline();
    selectCue(cue.id);
  });

  // Click/mousedown on cue to select & start drag
  document.getElementById('seqLanesWrap').addEventListener('mousedown', (e) => {
    const cueEl = e.target.closest('.seq-cue');
    if (!cueEl) return;

    const cueId = +cueEl.dataset.cueId;
    selectCue(cueId);
    const cue = seqCues.find(c => c.id === cueId);
    if (!cue) return;

    if (e.target.classList.contains('seq-cue-resize')) {
      seqDragState = {
        type: 'resize', cueId, startX: e.clientX,
        origWidth: parseFloat(cueEl.style.width), origDurMs: cue.duration_ms,
      };
    } else {
      seqDragState = {
        type: 'move', cueId, startX: e.clientX,
        origLeft: parseFloat(cueEl.style.left), origStartMs: cue.start_ms,
      };
    }
    e.preventDefault();
  });

  // Mouse move for drag/resize
  document.addEventListener('mousemove', (e) => {
    if (!seqDragState) return;
    const dx = e.clientX - seqDragState.startX;
    const cueEl = document.querySelector(`.seq-cue[data-cue-id="${seqDragState.cueId}"]`);
    if (!cueEl) return;

    if (seqDragState.type === 'move') {
      cueEl.style.left = Math.max(0, seqDragState.origLeft + dx) + 'px';
    } else {
      cueEl.style.width = Math.max(4, seqDragState.origWidth + dx) + 'px';
    }
  });

  // Mouse up to commit drag
  document.addEventListener('mouseup', async (e) => {
    if (!seqDragState) return;
    const cueId = seqDragState.cueId;
    const cue = seqCues.find(c => c.id === cueId);
    const cueEl = document.querySelector(`.seq-cue[data-cue-id="${cueId}"]`);
    if (!cue || !cueEl) { seqDragState = null; return; }

    if (seqDragState.type === 'move') {
      const newLeft = parseFloat(cueEl.style.left);
      cue.start_ms = Math.round(snapToGrid((newLeft / seqZoomPxPerSec) * 1000));
      await fetch(`/api/cues/${cueId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_ms: cue.start_ms })
      });
    } else {
      const newWidth = parseFloat(cueEl.style.width);
      cue.duration_ms = Math.max(100, Math.round(snapToGrid((newWidth / seqZoomPxPerSec) * 1000)));
      await fetch(`/api/cues/${cueId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_ms: cue.duration_ms })
      });
    }
    seqDragState = null;
    renderSequencerTimeline();
    if (seqSelectedCueId === cueId) selectCue(cueId);
  });

  // Apply cue properties
  document.getElementById('seqPropSave').addEventListener('click', async () => {
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
  });

  // Delete cue
  document.getElementById('seqPropDelete').addEventListener('click', async () => {
    if (!seqSelectedCueId) return;
    await fetch(`/api/cues/${seqSelectedCueId}`, { method: 'DELETE' });
    seqCues = seqCues.filter(c => c.id !== seqSelectedCueId);
    seqSelectedCueId = null;
    document.getElementById('seqProperties').classList.remove('open');
    document.getElementById('seqCueCount').textContent = seqCues.length;
    renderSequencerTimeline();
  });

  // Type change — re-render channel sliders without resetting dropdown
  document.getElementById('seqPropType').addEventListener('change', () => {
    if (seqSelectedCueId) {
      const newType = document.getElementById('seqPropType').value;
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

  // Click on ruler to set playhead
  document.getElementById('seqRuler').addEventListener('click', (e) => {
    const rect = document.getElementById('seqRuler').getBoundingClientRect();
    const x = e.clientX - rect.left;
    seqPlayheadMs = (x / seqZoomPxPerSec) * 1000;
    updatePlayhead();
  });

  // Effects management
  document.getElementById('seqAddEffectBtn').addEventListener('click', () => openEffectModal(null));
  document.getElementById('effSaveBtn').addEventListener('click', saveEffect);
  document.getElementById('effType').addEventListener('change', (e) => {
    renderEffectParams(e.target.value, {});
  });
}

// ─── Cue Selection & Properties ──────────────────────────────────────────────

function selectCue(cueId) {
  seqSelectedCueId = cueId;
  const cue = seqCues.find(c => c.id === cueId);

  document.querySelectorAll('.seq-cue.selected').forEach(el => el.classList.remove('selected'));
  const cueEl = document.querySelector(`.seq-cue[data-cue-id="${cueId}"]`);
  if (cueEl) cueEl.classList.add('selected');

  if (!cue) { document.getElementById('seqProperties').classList.remove('open'); return; }

  const propsEl = document.getElementById('seqProperties');
  propsEl.classList.add('open');

  const cueType = cue.cue_type || 'static';

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

  // Build channel sliders based on stored type
  renderCueChannelSliders(cueId, cueType);
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

  const chColorMap = {
    red: '#f44', green: '#4f4', blue: '#44f', white: '#fff',
    dimmer: '#ff0', amber: '#fa0', uv: '#a0f',
  };

  let html = '<div class="seq-ch-start" style="margin-bottom:6px"><div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">START VALUES</div><div style="display:flex;gap:12px;flex-wrap:wrap">';
  for (const ch of fix.channels) {
    const val = chVals[ch.type] !== undefined ? chVals[ch.type] : 0;
    const color = chColorMap[ch.type] || '#888';
    html += `<div class="seq-ch-slider" data-ch-type="${ch.type}">` +
      `<label style="color:${color}">${ch.type.substring(0, 4).toUpperCase()}</label>` +
      `<input type="range" min="0" max="255" value="${val}" oninput="this.nextElementSibling.textContent=this.value;updateCueColorFromSliders()">` +
      `<span class="seq-ch-val">${val}</span></div>`;
  }
  html += '</div></div>';

  // End values — always shown for transition support
  if (cueType !== 'effect') {
    const endVals = cue.end_channel_values || {};
    const hasEnd = Object.keys(endVals).length > 0;
    html += '<div class="seq-ch-end" style="margin-bottom:6px"><div style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text-dim);margin-bottom:4px">' +
      '<span>END VALUES</span>' +
      '<button type="button" class="btn btn-sm" style="font-size:9px;padding:1px 6px" onclick="copyStartToEnd()">Copy Start→End</button>' +
      '</div><div style="display:flex;gap:12px;flex-wrap:wrap">';
    for (const ch of fix.channels) {
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
  for (const eff of seqEffects) {
    html += `<div class="seq-effect-card" data-eff-id="${eff.id}">` +
      `<span class="eff-type ${eff.type}">${eff.type.replace('_', ' ')}</span>` +
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
  document.getElementById('effDurBeats').value = eff ? eff.duration_beats : 4;
  renderEffectParams(eff ? eff.type : 'pulse', eff ? eff.effect_data : {});
  document.getElementById('effectModal').classList.add('open');
}

function renderEffectParams(type, data) {
  const area = document.getElementById('effParamsArea');
  let html = '';
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
  }
  return {};
}

async function saveEffect() {
  const name = document.getElementById('effName').value.trim();
  if (!name) { alert('Name is required'); return; }
  const type = document.getElementById('effType').value;
  const category = document.getElementById('effCategory').value;
  const duration_beats = +(document.getElementById('effDurBeats').value || 4);
  const effect_data = getEffectDataFromForm(type);

  const body = { name, type, category, effect_data, duration_beats };
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
      // Could auto-select the sequence in the UI
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
  if (msg.deck === seqDeck && seqIsPlaying && seqCurrentSeq) {
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
  if (deckNum === seqDeck && seqCurrentSeq && seqIsPlaying) {
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
