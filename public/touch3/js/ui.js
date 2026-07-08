/* Thaluxis Touch 3 — rendering */
'use strict';

const UI = {};

/* ── Topbar ── */
UI.setConnected = function (ok) {
  const pip = document.getElementById('statusPip');
  pip.className = 'status-pip ' + (ok ? 'ok' : 'err');
};

UI.renderTopButtons = function () {
  const out = document.getElementById('btnOutput');
  out.textContent = S.outputEnabled ? 'OUTPUT ON' : 'OUTPUT OFF';
  out.classList.toggle('off', !S.outputEnabled);
  document.getElementById('btnBlackout').classList.toggle('active', S.blackoutActive);
};

UI.updateDecks = function (decks) {
  for (const n of [1, 2]) {
    const d = decks && decks[n];
    const chip = document.getElementById('deckChip' + n);
    const dot = document.getElementById('deckDot' + n);
    const track = document.getElementById('deckTrack' + n);
    const bpm = document.getElementById('deckBpm' + n);
    if (!chip) continue;
    const playing = d && d.play > 0;
    const hasTrack = d && !!d.filename;
    chip.classList.toggle('playing', !!playing);
    dot.className = 'dc-dot' + (playing ? ' playing' : (hasTrack ? ' paused' : ''));
    if (hasTrack) {
      track.textContent = d.filename;
      track.classList.remove('empty');
    } else {
      track.textContent = 'No track';
      track.classList.add('empty');
    }
    bpm.textContent = d && d.bpm > 0 ? Math.round(d.bpm) + ' BPM' : '';
  }
};

/* ── Quick actions board ── */
UI.renderActionsGrid = function () {
  const grid = document.getElementById('actionsGrid');
  const enabled = S.touchActions.filter((a) => a.enabled);
  if (!enabled.length) {
    grid.innerHTML = '<div class="empty-note">No action buttons configured.<br>Use Config &rarr; Touch Actions in the main UI.</div>';
    return;
  }

  let maxCol = 4;
  for (const a of enabled) {
    const endCol = (a.grid_col || 0) + (a.grid_w || 1);
    if (endCol > maxCol) maxCol = endCol;
  }
  grid.style.setProperty('--ag-cols', maxCol);

  grid.innerHTML = enabled.map((a) => {
    const style = 'background:' + (a.color || '#333') + ';color:' + (a.text_color || '#fff') +
      ';grid-column:' + ((a.grid_col || 0) + 1) + ' / span ' + (a.grid_w || 1) +
      ';grid-row:' + ((a.grid_row || 0) + 1) + ' / span ' + (a.grid_h || 1);
    const isActive = a.action_type === 'scene'
      ? S.activeSceneId != null && (a.action_data || {}).scene_id === S.activeSceneId
      : S.actionActiveStates[a.id];
    const activeClass = isActive ? ' action-active' : '';
    return '<button class="action-btn' + activeClass + '" data-aid="' + a.id + '" style="' + style + '">' +
      (a.icon ? '<span class="ab-icon">' + a.icon + '</span>' : '') +
      '<span class="ab-label">' + esc(a.label) + '</span></button>';
  }).join('');

  grid.querySelectorAll('.action-btn').forEach((btn) => {
    const aid = +btn.dataset.aid;
    const action = S.touchActions.find((a) => a.id === aid);
    if (!action) return;

    if (action.action_type === 'scene') {
      btn.addEventListener('click', () => {
        const sid = (action.action_data || {}).scene_id;
        if (!sid) return;
        if (S.activeSceneId === sid) Actions.deactivateScene();
        else Actions.activateScene(sid);
        UI.renderActionsGrid();
        UI.renderScenes();
      });
    } else {
      bindHoldToggle(
        btn,
        () => { Actions.executeTouchAction(action, true); btn.classList.add('held'); },
        () => { Actions.executeTouchAction(action, false); btn.classList.remove('held'); },
        () => S.colorHoldMode,
      );
    }
  });
};

/* ── Colors ── */
UI.renderColorTargets = function () {
  const row = document.getElementById('colorTargetGroups');
  if (!S.groups.length) { row.innerHTML = ''; return; }
  const chips = [{ id: null, name: 'All' }].concat(S.groups);
  row.innerHTML = chips.map((g) => {
    const active = S.selectedGroup === g.id ? ' active' : '';
    return '<button class="chip' + active + '" data-gid="' + (g.id == null ? '' : g.id) + '">' + esc(g.name) + '</button>';
  }).join('');
  row.querySelectorAll('.chip').forEach((el) => {
    el.addEventListener('click', () => {
      S.selectedGroup = el.dataset.gid === '' ? null : +el.dataset.gid;
      UI.renderColorTargets();
    });
  });
};

UI.renderColors = function () {
  const grid = document.getElementById('colorGrid');
  grid.innerHTML = COLORS.map((c, i) => {
    const light = c.name === 'White' || c.name === 'Yellow' || c.name === 'Lime' || c.name === 'Cyan';
    const active = !S.colorHoldMode && S.selectedColor === i ? ' active' : '';
    return '<div class="color-tile' + active + '" data-idx="' + i + '" style="background:' + c.hex + '">' +
      '<span class="color-label' + (light ? ' on-light' : '') + '">' + c.name + '</span></div>';
  }).join('');

  grid.querySelectorAll('.color-tile').forEach((el) => {
    const idx = +el.dataset.idx;
    bindHoldToggle(
      el,
      () => {
        S.selectedColor = idx;
        Actions.colorOn(COLORS[idx]);
        if (!S.colorHoldMode) UI.renderColors();
        else el.classList.add('active');
      },
      () => {
        S.selectedColor = null;
        Actions.colorOff();
        if (!S.colorHoldMode) UI.renderColors();
        else el.classList.remove('active');
      },
      () => S.colorHoldMode,
    );
  });
};

/* ── Effects (tabbed by category) ── */
UI.renderEffects = function () {
  const tabs = document.getElementById('fxTabs');
  const grid = document.getElementById('fxGrid');
  const byCat = {};
  for (const e of S.effects) {
    const cat = effectSlot(e.type);
    (byCat[cat] = byCat[cat] || []).push(e);
  }
  const cats = EFFECT_CATEGORIES.filter((c) => (byCat[c.key] || []).length);
  if (!cats.length) {
    tabs.innerHTML = '';
    grid.innerHTML = '<div class="scene-empty">No effects saved. Create effects in the main UI.</div>';
    return;
  }
  if (!cats.some((c) => c.key === S.fxTab)) S.fxTab = cats[0].key;

  tabs.innerHTML = cats.map((c) => {
    const active = S.fxTab === c.key ? ' active' : '';
    const running = S.activeEffectSlots[c.key] ? '<span class="fx-tab-dot"></span>' : '';
    return '<button class="fx-tab' + active + '" data-cat="' + c.key + '">' + c.label + running + '</button>';
  }).join('');
  tabs.querySelectorAll('.fx-tab').forEach((el) => {
    el.addEventListener('click', () => { S.fxTab = el.dataset.cat; UI.renderEffects(); });
  });

  const cat = cats.find((c) => c.key === S.fxTab);
  grid.innerHTML = byCat[cat.key].map((e) => {
    const active = S.activeEffectSlots[cat.key] === e.id ? ' active' : '';
    return '<button class="fx-tile' + active + '" data-eid="' + e.id + '" ' +
      'style="background:' + cat.bg + ';border-color:' + cat.border + ';color:var(--text)">' + esc(e.name) + '</button>';
  }).join('');
  grid.querySelectorAll('.fx-tile').forEach((el) => {
    el.addEventListener('click', () => {
      const eff = S.effects.find((e) => e.id === +el.dataset.eid);
      if (eff) { Actions.toggleEffect(eff.id, eff.type); UI.renderEffects(); }
    });
  });
};

UI.syncEffectSpeed = function () {
  document.getElementById('effectSpeed').value = Math.round(S.effectSpeed * 100);
  document.getElementById('effectSpeedVal').textContent = S.effectSpeed.toFixed(1) + 'x';
};

/* ── Scenes ── */
UI.renderScenes = function () {
  const list = document.getElementById('scenesList');
  const status = document.getElementById('sceneActiveStatus');
  if (!S.scenes.length) {
    list.innerHTML = '<div class="scene-empty">No scenes saved. Create scenes in the main UI.</div>';
    status.innerHTML = '';
    return;
  }
  list.innerHTML = S.scenes.map((sc) => {
    const active = S.activeSceneId === sc.id ? ' active-scene' : '';
    const dots = (sc.entries || []).slice(0, 8).map((en) => {
      let cv = {};
      try { cv = typeof en.channel_values === 'string' ? JSON.parse(en.channel_values) : (en.channel_values || {}); } catch { /* ignore bad JSON */ }
      return '<span class="sc-dot" style="background:rgb(' + (cv.red || 0) + ',' + (cv.green || 0) + ',' + (cv.blue || 0) + ')"></span>';
    }).join('');
    return '<div class="scene-card' + active + '" data-sid="' + sc.id + '">' +
      '<div class="sc-name">' + esc(sc.name) + '</div><div class="sc-dots">' + dots + '</div></div>';
  }).join('');

  const activeScene = S.scenes.find((sc) => sc.id === S.activeSceneId);
  status.innerHTML = activeScene
    ? '<span class="scene-active-badge" id="btnDeactivateScene"><span class="dot"></span>' + esc(activeScene.name) + ' &#10005;</span>'
    : '';
  const badge = document.getElementById('btnDeactivateScene');
  if (badge) badge.addEventListener('click', () => { Actions.deactivateScene(); UI.renderScenes(); });

  list.querySelectorAll('.scene-card').forEach((el) => {
    el.addEventListener('click', () => {
      const sid = +el.dataset.sid;
      if (S.activeSceneId === sid) Actions.deactivateScene();
      else Actions.activateScene(sid);
      UI.renderScenes();
    });
  });
};

/* ── Movers ── */
UI.renderMovers = function () {
  const card = document.getElementById('moversCard');
  const movers = getMoverFixtures();
  if (!movers.length) { card.style.display = 'none'; return; }
  card.style.display = '';

  const chips = document.getElementById('moverChips');
  chips.innerHTML = movers.map((f) => {
    const sel = S.selectedMovers.size === 0 || S.selectedMovers.has(f.id) ? ' active' : '';
    return '<button class="chip' + sel + '" data-fid="' + f.id + '">' + esc(f.name) + '</button>';
  }).join('');
  chips.querySelectorAll('.chip').forEach((el) => {
    el.addEventListener('click', () => {
      const fid = +el.dataset.fid;
      if (S.selectedMovers.size === 0) {
        // "All" implied — switch to explicit selection of just this one
        S.selectedMovers = new Set([fid]);
      } else if (S.selectedMovers.has(fid)) {
        S.selectedMovers.delete(fid);
        if (S.selectedMovers.size === 0) S.selectedMovers = new Set(); // back to all
      } else {
        S.selectedMovers.add(fid);
      }
      UI.renderMovers();
    });
  });

  const grid = document.getElementById('moverPresetGrid');
  grid.innerHTML = S.moverPresets.length
    ? S.moverPresets.map((p) =>
        '<button class="preset-btn" data-pid="' + p.id + '">' +
        '<span>' + (p.icon || '&#9673;') + '</span><span>' + esc(p.name) + '</span></button>').join('')
    : '<div class="scene-empty">No mover presets saved.</div>';
  grid.querySelectorAll('.preset-btn').forEach((el) => {
    el.addEventListener('click', () => {
      Actions.applyMoverPreset(+el.dataset.pid, getSelectedMovers().map((f) => f.id));
    });
  });
};

/* ── Sliders / Lights modal ── */
UI.syncMasterDim = function () {
  document.getElementById('masterDim').value = S.masterDim;
  document.getElementById('masterDimVal').textContent = S.masterDim;
};

UI.renderGroupDimmers = function () {
  const host = document.getElementById('groupDimmers');
  const label = document.getElementById('groupDimLabel');
  if (!S.groups.length) { host.innerHTML = ''; label.style.display = 'none'; return; }
  label.style.display = '';
  host.innerHTML = S.groups.map((g) => {
    const v = S.groupDimmer[g.id] !== undefined ? S.groupDimmer[g.id] : 255;
    return '<div class="gd-row">' +
      '<span class="gd-name">' + esc(g.name) + '</span>' +
      '<input type="range" min="0" max="255" value="' + v + '" data-gid="' + g.id + '">' +
      '<span class="s-val" id="gdVal' + g.id + '">' + v + '</span></div>';
  }).join('');
  host.querySelectorAll('input[type=range]').forEach((el) => {
    el.addEventListener('input', () => {
      const gid = +el.dataset.gid;
      const v = +el.value;
      document.getElementById('gdVal' + gid).textContent = v;
      Actions.setGroupDimmer(gid, v);
    });
  });
};

UI.syncGroupDimmers = function () {
  document.querySelectorAll('#groupDimmers input[type=range]').forEach((el) => {
    const gid = +el.dataset.gid;
    const v = S.groupDimmer[gid] !== undefined ? S.groupDimmer[gid] : 255;
    el.value = v;
    const valEl = document.getElementById('gdVal' + gid);
    if (valEl) valEl.textContent = v;
  });
};

UI.renderGroupToggles = function () {
  const grid = document.getElementById('groupToggles');
  const label = document.getElementById('groupTogglesLabel');
  const groups = S.groups.filter((g) => groupFixtures(g.id).length);
  if (!groups.length) { grid.innerHTML = ''; label.style.display = 'none'; return; }
  label.style.display = '';

  function groupFixtures(gid) {
    return S.fixtures.filter((f) => (f.group_ids || []).includes(gid));
  }

  grid.innerHTML = groups.map((g) => {
    const members = groupFixtures(g.id);
    const onCount = members.filter((f) => S.fixtureEnabled[f.id] !== false).length;
    const cls = onCount === members.length ? ' on' : (onCount > 0 ? ' partial' : '');
    return '<div class="fixture-tile group-tile' + cls + '" data-gid="' + g.id + '">' +
      '<span class="bulb">&#128161;</span>' +
      '<div class="f-info"><div class="f-name">' + esc(g.name) + '</div>' +
      '<div class="f-sub">' + onCount + ' of ' + members.length + ' on</div></div></div>';
  }).join('');

  grid.querySelectorAll('.group-tile').forEach((el) => {
    el.addEventListener('click', () => {
      const gid = +el.dataset.gid;
      const members = groupFixtures(gid);
      // If every fixture is on, turn the group off; otherwise turn all on
      const allOn = members.every((f) => S.fixtureEnabled[f.id] !== false);
      members.forEach((f) => Actions.setFixtureEnabled(f.id, !allOn));
      UI.renderGroupToggles();
      UI.renderFixtureGrid();
    });
  });
};

UI.renderFixtureGrid = function () {
  const grid = document.getElementById('fixtureGrid');
  grid.innerHTML = S.fixtures.map((f) => {
    const on = S.fixtureEnabled[f.id] !== false;
    return '<div class="fixture-tile' + (on ? ' on' : '') + '" data-fid="' + f.id + '">' +
      '<span class="bulb">&#128161;</span>' +
      '<div class="f-info"><div class="f-name">' + esc(f.name) + '</div>' +
      '<div class="f-sub">U' + (f.universe || 1) + ' &middot; ch ' + (f.start_address || (f.channels[0] && f.channels[0].dmx_address) || '?') + '</div></div></div>';
  }).join('');
  grid.querySelectorAll('.fixture-tile').forEach((el) => {
    el.addEventListener('click', () => {
      const fid = +el.dataset.fid;
      const nowOn = S.fixtureEnabled[fid] === false;
      Actions.setFixtureEnabled(fid, nowOn);
      UI.renderFixtureGrid();
      UI.renderGroupToggles();
    });
  });
};

/* ── Render everything ── */
UI.renderAll = function () {
  UI.renderTopButtons();
  UI.renderActionsGrid();
  UI.renderColorTargets();
  UI.renderColors();
  UI.renderEffects();
  UI.syncEffectSpeed();
  UI.renderScenes();
  UI.renderMovers();
  UI.syncMasterDim();
  UI.renderGroupToggles();
  UI.renderGroupDimmers();
  UI.renderFixtureGrid();
};
