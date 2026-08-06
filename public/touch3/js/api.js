/* Thaluxis Touch 3 — server API + WebSocket */
'use strict';

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).catch(() => {});
}

async function fetchAllData() {
  const results = await Promise.allSettled([
    fetch('/api/fixture-channel-map').then((r) => r.json()),
    fetch('/api/groups').then((r) => r.json()),
    fetch('/api/scenes').then((r) => r.json()),
    fetch('/api/scenes/active').then((r) => r.json()),
    fetch('/api/effects').then((r) => r.json()),
    fetch('/api/touch-actions').then((r) => r.json()),
    fetch('/api/mover-presets').then((r) => r.json()),
    fetch('/api/dmx/output').then((r) => r.json()),
    fetch('/api/touch/state').then((r) => r.json()),
  ]);
  const [fixtures, groups, scenes, activeScene, effects, touchActions, moverPresets, output, touchState] =
    results.map((r) => (r.status === 'fulfilled' ? r.value : null));

  if (fixtures) {
    S.fixtures = fixtures;
    fixtures.forEach((f) => {
      if (S.fixtureEnabled[f.id] === undefined) S.fixtureEnabled[f.id] = true;
    });
  }
  if (groups) {
    S.groups = groups;
    groups.forEach((g) => { if (S.groupDimmer[g.id] === undefined) S.groupDimmer[g.id] = 255; });
  }
  if (scenes) S.scenes = scenes;
  if (activeScene) S.activeSceneId = activeScene.activeSceneId;
  if (effects) S.effects = effects;
  if (touchActions) S.touchActions = touchActions;
  if (moverPresets) S.moverPresets = moverPresets;
  if (output) S.outputEnabled = output.enabled;
  if (touchState) {
    (touchState.disabledFixtures || []).forEach((id) => { S.fixtureEnabled[id] = false; });
    S.blackoutActive = !!touchState.blackoutHold;
    if (touchState.masterDimmer !== undefined) S.masterDim = touchState.masterDimmer;
    if (touchState.effectSpeed !== undefined) S.effectSpeed = touchState.effectSpeed;
    if (touchState.groupDimmers && typeof touchState.groupDimmers === 'object') {
      for (const [gid, val] of Object.entries(touchState.groupDimmers)) {
        S.groupDimmer[+gid] = val;
      }
    }
  }
}

/* ── WebSocket ── */
let _wsBackoff = 1000;
const WS_BACKOFF_MAX = 15000;

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  S.ws = new WebSocket(proto + '//' + location.host);
  S.ws.onopen = () => { _wsBackoff = 1000; UI.setConnected(true); };
  S.ws.onclose = () => {
    UI.setConnected(false);
    setTimeout(connectWebSocket, _wsBackoff);
    _wsBackoff = Math.min(_wsBackoff * 2, WS_BACKOFF_MAX);
  };
  S.ws.onerror = () => S.ws.close();
  S.ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case 'dmxOutput':
        S.outputEnabled = msg.enabled;
        UI.renderTopButtons();
        break;
      case 'touchBlackoutHold':
        S.blackoutActive = msg.active;
        UI.renderTopButtons();
        break;
      case 'touchFixtureDisable':
        S.fixtureEnabled[msg.fixtureId] = !msg.disabled;
        UI.renderFixtureGrid();
        UI.renderGroupToggles();
        break;
      case 'masterDimmer':
        if (msg.value !== undefined) { S.masterDim = msg.value; UI.syncMasterDim(); }
        break;
      case 'effectSpeed':
        if (msg.value !== undefined) { S.effectSpeed = msg.value; UI.syncEffectSpeed(); }
        break;
      case 'groupDimmer':
        if (msg.group_id !== undefined) { S.groupDimmer[msg.group_id] = msg.value; UI.syncGroupDimmers(); }
        break;
      case 'scene_activated':
        S.activeSceneId = msg.sceneId != null ? msg.sceneId : null;
        UI.renderScenes();
        UI.renderActionsGrid();
        break;
      case 'scene_deactivated':
        S.activeSceneId = null;
        UI.renderScenes();
        UI.renderActionsGrid();
        break;
      case 'state':
        if (msg.state && msg.state.decks) UI.updateDecks(msg.state.decks);
        break;
    }
  };
}
