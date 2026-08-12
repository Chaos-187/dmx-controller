/* Thaluxis Touch 3 — thin action layer.
   No DMX is computed here: every control calls a server API and the
   server (same engine as MIDI / OS2L / Companion) drives the DMX output. */
'use strict';

const Actions = {};

/** Fire a server-side action (same engine as MIDI mappings / Companion). */
Actions.trigger = function (actionType, actionData, mode) {
  return post('/api/touch/trigger', {
    action_type: actionType,
    action_data: actionData || {},
    mode: mode || 'on',
    key: 'touch3-' + actionType,
  });
};

/* ── Colors ── */
Actions.colorOn = function (color) {
  const scale = S.colorIntensity / 255;
  const groupId = S.selectedGroup || undefined;
  Actions.trigger('color', {
    red: Math.round(color.r * scale),
    green: Math.round(color.g * scale),
    blue: Math.round(color.b * scale),
    white: (color.r === 255 && color.g === 255 && color.b === 255) ? Math.round(255 * scale) : 0,
    group_id: groupId,
  }, 'on');
};

Actions.colorOff = function () {
  Actions.trigger('color', { red: 0, green: 0, blue: 0, white: 0, group_id: S.selectedGroup || undefined }, 'off');
};

/* ── Atmosphere / show controls ── */
Actions.strobe = (on) => Actions.trigger('strobe', {}, on ? 'on' : 'off');
Actions.smoke = (on) => Actions.trigger('smoke', {}, on ? 'on' : 'off');
Actions.fire = (on) => Actions.trigger('fire', {}, on ? 'on' : 'off');
Actions.fullOn = (on) => Actions.trigger('full_on', {}, on ? 'on' : 'off');
Actions.stopEverything = () => Actions.trigger('stop_all_effects', {}, 'on');

/* ── Output / blackout ── */
Actions.toggleOutput = function () {
  S.outputEnabled = !S.outputEnabled;
  post('/api/dmx/output', { enabled: S.outputEnabled });
};

Actions.setBlackout = function (active) {
  S.blackoutActive = active;
  post('/api/touch/blackout-hold', { active });
  if (active) {
    S.activeEffectSlots = {};
    S.activeSceneId = null;
    S.selectedColor = null;
    UI.renderEffects();
    UI.renderScenes();
    UI.renderColors();
    UI.renderActionsGrid();
    UI.renderPanelNav();
  }
};

/* ── Dimmers / speed ── */
Actions.setMasterDimmer = function (v) {
  S.masterDim = v;
  post('/api/touch/master-dimmer', { value: v });
};

Actions.setGroupDimmer = function (groupId, v) {
  S.groupDimmer[groupId] = v;
  post('/api/touch/group-dimmer', { groupId, value: v });
};

Actions.setEffectSpeed = function (speed) {
  post('/api/touch/effect-speed', { value: speed });
};

/* ── Fixtures ── */
Actions.setFixtureEnabled = function (id, enabled) {
  S.fixtureEnabled[id] = enabled;
  post('/api/touch/fixture-disable', { fixtureId: id, disabled: !enabled });
};

/* ── Effects ── */
Actions.applyFxPalettePreset = function (key) {
  const preset = FX_PALETTE_PRESETS[key];
  if (!preset) return;
  S.fxPalettePreset = key;
  if (preset.mode === 'hsl') {
    S.fxPaletteMode = 'hsl';
  } else {
    S.fxPaletteMode = 'palette';
    if (preset.colors) S.fxPaletteColors = preset.colors.slice(0, 4);
  }
  Actions.pushFxPaletteParams();
  UI.renderFxPalette();
};

let _fxPalDebounce = null;
Actions.pushFxPaletteParams = function () {
  clearTimeout(_fxPalDebounce);
  _fxPalDebounce = setTimeout(async () => {
    const payload = getFxPaletteParams();
    for (const slot of ['color', 'motion', 'multicell', 'rig', 'sound']) {
      if (!S.activeEffectSlots[slot]) continue;
      await post('/api/effects/params', { slot, effect_params: payload });
    }
  }, 80);
};

Actions.toggleEffect = function (effectId, effectType) {
  const effect = S.effects.find((e) => e.id === effectId) || { id: effectId, type: effectType };
  const slot = effectSlot(effectType);
  if (S.activeEffectSlots[slot] === effectId) {
    post('/api/effects/stop', { slot });
    delete S.activeEffectSlots[slot];
  } else {
    post('/api/effects/run', {
      effectId,
      fixtureIds: getEffectFixtureIds(effect),
      effect_params: getFxPaletteParams(),
    });
    S.activeEffectSlots[slot] = effectId;
  }
};

Actions.stopAllEffects = function () {
  post('/api/effects/stop', {});
  S.activeEffectSlots = {};
};

/* ── Movers (server computes the channel values) ── */
Actions.applyMoverPreset = function (presetId, fixtureIds) {
  return post('/api/touch/mover-preset', { presetId, fixtureIds });
};

Actions.sendMoverPosition = function (fixtureIds, pan, tilt, speed) {
  return post('/api/touch/mover-position', { fixtureIds, pan, tilt, speed });
};

Actions.clearMovementOverride = function (fixtureIds) {
  return post('/api/touch/movement-override', { fixtureIds, active: false });
};

/* ── Scenes ── */
Actions.activateScene = function (id) {
  S.activeSceneId = id;
  return post('/api/scenes/' + id + '/activate');
};

Actions.deactivateScene = function () {
  S.activeSceneId = null;
  return post('/api/scenes/deactivate');
};

/* ── Touch-action board (configured in Config → Touch Actions) ── */
Actions.executeTouchAction = function (action, on) {
  const data = action.action_data || {};
  switch (action.action_type) {
    case 'color':
      if (on) {
        Actions.trigger('color', {
          red: data.red || 0, green: data.green || 0, blue: data.blue || 0, white: data.white || 0,
        }, 'on');
      } else {
        Actions.trigger('color', { red: 0, green: 0, blue: 0, white: 0 }, 'off');
      }
      break;
    case 'quick_action':
      Actions.runQuickAction(data.action, on);
      break;
    case 'mover_preset':
      if (on && data.preset_index !== undefined) {
        const preset = (S.moverPresets || [])[data.preset_index];
        if (preset) Actions.applyMoverPreset(preset.id, getMoverFixtures().map((f) => f.id));
      }
      break;
    case 'effect':
      if (data.effect_id) Actions.toggleEffect(data.effect_id, (S.effects.find((e) => e.id === data.effect_id) || {}).type);
      break;
    case 'strobe':
      Actions.strobe(on);
      break;
    case 'smoke':
    case 'haze':
      Actions.smoke(on);
      break;
    case 'fire':
      Actions.fire(on);
      break;
    case 'blackout':
      if (on) Actions.setBlackout(true);
      break;
    case 'master_dimmer':
      if (on && data.value !== undefined) {
        Actions.setMasterDimmer(data.value);
        UI.syncMasterDim();
      }
      break;
    case 'scene':
      // Handled by the scene toggle logic in the grid renderer
      break;
  }
};

/** Legacy quick-action names used by the touch-action board. */
Actions.runQuickAction = function (name, on) {
  switch (name) {
    case 'fullWhite':
      Actions.trigger('color', { red: 255, green: 255, blue: 255, white: 255 }, on ? 'on' : 'off');
      break;
    case 'fullColor':
      if (on) {
        if (S.selectedColor === null) S.selectedColor = 0;
        Actions.colorOn(COLORS[S.selectedColor]);
      } else {
        Actions.colorOff();
      }
      break;
    case 'dimWarm':
      Actions.trigger('color', { red: 180, green: 100, blue: 40, white: 80 }, on ? 'on' : 'off');
      break;
    case 'uvMode':
      Actions.trigger('color', { red: 120, green: 0, blue: 255, white: 0 }, on ? 'on' : 'off');
      break;
    case 'strobe':
      Actions.strobe(on);
      break;
    case 'allOff':
      if (on) Actions.stopEverything();
      break;
  }
};
