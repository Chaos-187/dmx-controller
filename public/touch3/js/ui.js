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
    bindFavoriteDblTap(btn, () => Favorites.buildAction(action));
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
        else { el.classList.add('active'); UI.renderPanelNav(); }
      },
      () => {
        S.selectedColor = null;
        Actions.colorOff();
        if (!S.colorHoldMode) UI.renderColors();
        else { el.classList.remove('active'); UI.renderPanelNav(); }
      },
      () => S.colorHoldMode,
    );
    bindFavoriteDblTap(el, () => Favorites.buildColor(idx));
  });
  UI.renderPanelNav();
};

/* ── Effects (tabbed by category) ── */
UI.renderFxPalette = function () {
  const presets = document.getElementById('fxPalPresets');
  if (!presets || presets.dataset.wired !== '1') return;

  presets.querySelectorAll('.fx-pal-btn').forEach((btn) => {
    const key = btn.dataset.pal;
    const active = (key === 'custom' && S.fxPaletteMode === 'palette' && S.fxPalettePreset === 'custom')
      || (key === 'hsl' && S.fxPaletteMode === 'hsl')
      || (key !== 'custom' && key !== 'hsl' && S.fxPalettePreset === key);
    btn.classList.toggle('active', !!active);
  });

  const customRow = document.getElementById('fxPalCustomRow');
  if (customRow) customRow.style.display = S.fxPaletteMode === 'palette' ? 'flex' : 'none';

  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('fxPalC' + i);
    if (el && S.fxPaletteColors[i]) el.value = S.fxPaletteColors[i];
  }
};

UI.wireFxPalette = function () {
  const presets = document.getElementById('fxPalPresets');
  if (!presets || presets.dataset.wired === '1') return;
  presets.dataset.wired = '1';

  presets.innerHTML = Object.entries(FX_PALETTE_PRESETS).map(([key, p]) =>
    '<button type="button" class="fx-pal-btn" data-pal="' + key + '">' + esc(p.label) + '</button>',
  ).join('');

  presets.querySelectorAll('.fx-pal-btn').forEach((btn) => {
    btn.addEventListener('click', () => Actions.applyFxPalettePreset(btn.dataset.pal));
    bindFavoriteDblTap(btn, () => Favorites.buildFxPalette(btn.dataset.pal));
  });

  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('fxPalC' + i);
    if (!el) continue;
    el.addEventListener('input', () => {
      S.fxPaletteColors[i] = el.value;
      S.fxPaletteMode = 'palette';
      S.fxPalettePreset = 'custom';
      Actions.pushFxPaletteParams();
      UI.renderFxPalette();
    });
  }
};

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
    UI.renderFxPalette();
    return;
  }
  if (!cats.some((c) => c.key === S.fxTab)) {
    S.fxTab = cats.find((c) => c.key === 'multicell') ? 'multicell' : cats[0].key;
  }

  tabs.innerHTML = cats.map((c) => {
    const active = S.fxTab === c.key ? ' active' : '';
    const running = S.activeEffectSlots[c.key] ? '<span class="fx-tab-dot"></span>' : '';
    return '<button class="fx-tab' + active + '" data-cat="' + c.key + '">' + c.label + running + '</button>';
  }).join('');
  tabs.querySelectorAll('.fx-tab').forEach((el) => {
    el.addEventListener('click', () => { S.fxTab = el.dataset.cat; UI.renderEffects(); UI.renderFxPalette(); });
  });

  const cat = cats.find((c) => c.key === S.fxTab);
  const list = sortEffectsForTouch(byCat[cat.key] || []);
  const legend = document.getElementById('fxMotionLegend');
  if (legend) {
    const hasMotionOnly = list.some((e) => isMotionOnlyEffect(e.type));
    legend.hidden = !hasMotionOnly;
  }
  if (!list.length) {
    grid.innerHTML = '<div class="scene-empty">No effects in this category.</div>';
  } else {
    grid.innerHTML = list.map((e) => {
      const active = S.activeEffectSlots[cat.key] === e.id ? ' active' : '';
      const motionOnly = isMotionOnlyEffect(e.type);
      const bg = motionOnly ? MOTION_ONLY_TILE.bg : cat.bg;
      const border = motionOnly ? MOTION_ONLY_TILE.border : cat.border;
      const motionCls = motionOnly ? ' fx-motion-only' : '';
      return '<button class="fx-tile' + active + motionCls + '" data-eid="' + e.id + '" ' +
        'style="background:' + bg + ';border-color:' + border + ';color:var(--text)">' + esc(e.name) + '</button>';
    }).join('');
    grid.querySelectorAll('.fx-tile').forEach((el) => {
      el.addEventListener('click', () => {
        const eff = S.effects.find((e) => e.id === +el.dataset.eid);
        if (eff) { Actions.toggleEffect(eff.id, eff.type); UI.renderEffects(); UI.renderFxPalette(); }
      });
      bindFavoriteDblTap(el, () => {
        const eff = S.effects.find((e) => e.id === +el.dataset.eid);
        return Favorites.buildEffect(eff);
      });
    });
  }
  UI.renderFxPalette();
  UI.renderPanelNav();
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
    bindFavoriteDblTap(el, () => {
      const sc = S.scenes.find((s) => s.id === +el.dataset.sid);
      return Favorites.buildScene(sc);
    });
  });
  UI.renderPanelNav();
};

/* ── Mirror ball spin ── */
UI.renderMirror = function () {
  const mirrors = getMirrorBallFixtures();
  const btn = document.getElementById('btnMirror');
  if (!mirrors.length) {
    if (btn) btn.style.display = 'none';
    return;
  }
  if (btn) btn.style.display = '';
};

/* ── Movers ── */
UI.renderMovers = function () {
  const movers = getMoverFixtures();
  const btn = document.getElementById('btnMovers');
  if (!movers.length) {
    if (btn) btn.style.display = 'none';
    return;
  }
  if (btn) btn.style.display = '';

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
    bindFavoriteDblTap(el, () => {
      const p = S.moverPresets.find((mp) => mp.id === +el.dataset.pid);
      return Favorites.buildMoverPreset(p);
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

/* ── Toast ── */
let _toastTimer = null;
UI.showToast = function (msg) {
  const el = document.getElementById('touchToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
};

const FAV_KIND_LABELS = {
  color: 'Color', effect: 'Effect', scene: 'Scene', action: 'Action',
  mover_preset: 'Mover', fx_palette: 'Palette',
};

function isFavoriteActive(fav) {
  const p = fav.payload || {};
  switch (fav.kind) {
    case 'color': return S.selectedColor === p.colorIndex;
    case 'scene': return S.activeSceneId === p.sceneId;
    case 'effect': {
      const eff = S.effects.find((e) => e.id === p.effectId);
      if (!eff) return false;
      return S.activeEffectSlots[effectSlot(eff.type)] === p.effectId;
    }
    case 'fx_palette': return S.fxPalettePreset === p.presetKey;
    default: return false;
  }
}

UI.renderFavorites = function () {
  const grid = document.getElementById('favoritesGrid');
  const editBtn = document.getElementById('btnFavEdit');
  if (!grid) return;
  if (editBtn) {
    editBtn.textContent = S.favEditMode ? 'Done' : 'Edit';
    editBtn.classList.toggle('active', S.favEditMode);
  }
  grid.classList.toggle('edit-mode', S.favEditMode);

  if (!S.favorites.length) {
    grid.innerHTML = '<div class="scene-empty">No favorites yet.<br>Double-tap items on other tabs, or tap + Add.</div>';
    return;
  }

  grid.innerHTML = S.favorites.map((fav) => {
    const active = isFavoriteActive(fav) ? ' active-fav' : '';
    const bg = fav.color ? ' style="background:' + fav.color + '"' : '';
    const cls = fav.color ? ' has-color' : '';
    const light = fav.color && (fav.color.toLowerCase() === '#ffffff' || fav.color.toLowerCase() === '#fff8dc');
    return '<div class="fav-tile' + cls + active + (light ? ' on-light' : '') + '" data-fid="' + fav.id + '"' + bg + '>' +
      '<button type="button" class="fav-del" data-fid="' + fav.id + '" aria-label="Remove">&#10005;</button>' +
      (fav.icon ? '<span class="fav-icon">' + fav.icon + '</span>' : '') +
      '<span class="fav-label">' + esc(fav.label) + '</span>' +
      '<span class="fav-kind">' + (FAV_KIND_LABELS[fav.kind] || fav.kind) + '</span></div>';
  }).join('');

  grid.querySelectorAll('.fav-tile').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.fav-del')) return;
      const fav = S.favorites.find((f) => f.id === el.dataset.fid);
      Favorites.run(fav);
    });
  });
  grid.querySelectorAll('.fav-del').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      Favorites.remove(el.dataset.fid);
    });
  });
};

UI.renderFavPicker = function () {
  const tabs = document.getElementById('favPickerTabs');
  const body = document.getElementById('favPickerBody');
  if (!tabs || !body) return;

  const tabDefs = [
    { key: 'colors', label: 'Colors' },
    { key: 'effects', label: 'Effects' },
    { key: 'scenes', label: 'Scenes' },
    { key: 'actions', label: 'Actions' },
    { key: 'palettes', label: 'Palettes' },
  ];
  if (S.moverPresets.length) tabDefs.push({ key: 'movers', label: 'Movers' });

  tabs.innerHTML = tabDefs.map((t) =>
    '<button type="button" class="fav-picker-tab' + (S.favPickerTab === t.key ? ' active' : '') +
    '" data-tab="' + t.key + '">' + t.label + '</button>',
  ).join('');
  tabs.querySelectorAll('.fav-picker-tab').forEach((el) => {
    el.addEventListener('click', () => {
      S.favPickerTab = el.dataset.tab;
      UI.renderFavPicker();
    });
  });

  let html = '<div class="fav-picker-grid">';
  const tab = S.favPickerTab;

  if (tab === 'colors') {
    COLORS.forEach((c, i) => {
      const item = Favorites.buildColor(i);
      const cls = Favorites.has(item) ? ' is-fav' : '';
      html += '<button type="button" class="fav-picker-item' + cls + '" data-kind="color" data-idx="' + i + '" style="background:' + c.hex + ';color:#fff">' + esc(c.name) + '</button>';
    });
  } else if (tab === 'effects') {
    sortEffectsForTouch(S.effects).forEach((e) => {
      const item = Favorites.buildEffect(e);
      const cls = (Favorites.has(item) ? ' is-fav' : '') + (isMotionOnlyEffect(e.type) ? ' fx-motion-only' : '');
      const style = isMotionOnlyEffect(e.type)
        ? ' style="border-color:' + MOTION_ONLY_TILE.border + ';background:' + MOTION_ONLY_TILE.bg + '"'
        : '';
      html += '<button type="button" class="fav-picker-item' + cls + '" data-kind="effect" data-eid="' + e.id + '"' + style + '>' + esc(e.name) + '</button>';
    });
  } else if (tab === 'scenes') {
    S.scenes.forEach((sc) => {
      const item = Favorites.buildScene(sc);
      const cls = Favorites.has(item) ? ' is-fav' : '';
      html += '<button type="button" class="fav-picker-item' + cls + '" data-kind="scene" data-sid="' + sc.id + '">' + esc(sc.name) + '</button>';
    });
  } else if (tab === 'actions') {
    S.touchActions.filter((a) => a.enabled).forEach((a) => {
      const item = Favorites.buildAction(a);
      const cls = Favorites.has(item) ? ' is-fav' : '';
      html += '<button type="button" class="fav-picker-item' + cls + '" data-kind="action" data-aid="' + a.id + '">' + esc(a.label) + '</button>';
    });
  } else if (tab === 'palettes') {
    Object.keys(FX_PALETTE_PRESETS).forEach((key) => {
      if (key === 'custom') return;
      const item = Favorites.buildFxPalette(key);
      const cls = Favorites.has(item) ? ' is-fav' : '';
      html += '<button type="button" class="fav-picker-item' + cls + '" data-kind="fx_palette" data-pal="' + key + '">' + esc(FX_PALETTE_PRESETS[key].label) + '</button>';
    });
  } else if (tab === 'movers') {
    S.moverPresets.forEach((p) => {
      const item = Favorites.buildMoverPreset(p);
      const cls = Favorites.has(item) ? ' is-fav' : '';
      html += '<button type="button" class="fav-picker-item' + cls + '" data-kind="mover_preset" data-pid="' + p.id + '">' + esc(p.name) + '</button>';
    });
  }
  html += '</div>';
  body.innerHTML = html;

  body.querySelectorAll('.fav-picker-item:not(.is-fav)').forEach((el) => {
    el.addEventListener('click', () => {
      let item = null;
      if (el.dataset.kind === 'color') item = Favorites.buildColor(+el.dataset.idx);
      else if (el.dataset.kind === 'effect') item = Favorites.buildEffect(S.effects.find((e) => e.id === +el.dataset.eid));
      else if (el.dataset.kind === 'scene') item = Favorites.buildScene(S.scenes.find((s) => s.id === +el.dataset.sid));
      else if (el.dataset.kind === 'action') item = Favorites.buildAction(S.touchActions.find((a) => a.id === +el.dataset.aid));
      else if (el.dataset.kind === 'fx_palette') item = Favorites.buildFxPalette(el.dataset.pal);
      else if (el.dataset.kind === 'mover_preset') item = Favorites.buildMoverPreset(S.moverPresets.find((p) => p.id === +el.dataset.pid));
      if (item && Favorites.add(item)) UI.renderFavPicker();
    });
  });
};

UI.openFavAddModal = function () {
  const modal = document.getElementById('favAddModal');
  if (!modal) return;
  UI.renderFavPicker();
  modal.classList.add('open');
};

/* ── Panel navigation ── */
UI.setPanel = function (key) {
  S.activePanel = key;
  if (key !== 'favorites') S.favEditMode = false;
  document.querySelectorAll('.panel-page').forEach((el) => {
    el.classList.toggle('active', el.dataset.panel === key);
  });
  document.querySelectorAll('.panel-nav-btn').forEach((el) => {
    el.classList.toggle('active', el.dataset.panel === key);
  });
  if (key === 'favorites') UI.renderFavorites();
};

UI.renderPanelNav = function () {
  const fxRunning = Object.values(S.activeEffectSlots).some(Boolean);
  const sceneActive = S.activeSceneId != null;
  const colorActive = S.selectedColor !== null;
  document.querySelectorAll('.panel-nav-btn').forEach((el) => {
    const p = el.dataset.panel;
    el.classList.toggle('has-activity',
      (p === 'effects' && fxRunning) ||
      (p === 'scenes' && sceneActive) ||
      (p === 'colors' && colorActive));
  });
};

/* ── Render everything ── */
UI.renderAll = function () {
  UI.renderTopButtons();
  UI.renderActionsGrid();
  UI.renderColorTargets();
  UI.renderColors();
  UI.wireFxPalette();
  UI.renderEffects();
  UI.syncEffectSpeed();
  UI.renderScenes();
  UI.renderMovers();
  UI.renderMirror();
  UI.syncMasterDim();
  UI.renderGroupToggles();
  UI.renderGroupDimmers();
  UI.renderFixtureGrid();
  UI.renderFavorites();
  UI.setPanel(S.activePanel);
  UI.renderPanelNav();
};
