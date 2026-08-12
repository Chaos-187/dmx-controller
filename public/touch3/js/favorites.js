/* Thaluxis Touch 3 — favorites (persisted on server) */
'use strict';

const Favorites = {};

/** Stable key for deduplication. */
function favoriteKey(item) {
  if (!item || !item.kind) return '';
  const p = item.payload || {};
  switch (item.kind) {
    case 'color': return 'color:' + p.colorIndex;
    case 'effect': return 'effect:' + p.effectId;
    case 'scene': return 'scene:' + p.sceneId;
    case 'action': return 'action:' + p.actionId;
    case 'mover_preset': return 'mover_preset:' + p.presetId;
    case 'fx_palette': return 'fx_palette:' + p.presetKey;
    default: return item.kind + ':' + (item.label || '');
  }
}

function makeId() {
  return 'fav_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

Favorites.load = async function () {
  try {
    const data = await fetch('/api/touch3/favorites').then((r) => r.json());
    S.favorites = Array.isArray(data) ? data : [];
  } catch {
    S.favorites = [];
  }
};

Favorites.save = async function () {
  try {
    await fetch('/api/touch3/favorites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(S.favorites),
    });
  } catch { /* ignore */ }
};

Favorites.has = function (item) {
  const key = favoriteKey(item);
  return S.favorites.some((f) => favoriteKey(f) === key);
};

Favorites.add = function (item) {
  if (!item || !item.kind) return false;
  if (Favorites.has(item)) {
    UI.showToast('Already in favorites');
    return false;
  }
  const entry = {
    id: makeId(),
    kind: item.kind,
    label: item.label || 'Favorite',
    color: item.color || null,
    icon: item.icon || null,
    payload: item.payload || {},
  };
  S.favorites.push(entry);
  Favorites.save();
  UI.showToast('Added to favorites');
  if (S.activePanel === 'favorites') UI.renderFavorites();
  return true;
};

Favorites.remove = function (id) {
  S.favorites = S.favorites.filter((f) => f.id !== id);
  Favorites.save();
  UI.renderFavorites();
};

Favorites.buildColor = function (idx) {
  const c = COLORS[idx];
  if (!c) return null;
  return { kind: 'color', label: c.name, color: c.hex, payload: { colorIndex: idx } };
};

Favorites.buildEffect = function (effect) {
  if (!effect) return null;
  const cat = EFFECT_CATEGORIES.find((c) => c.key === effectSlot(effect.type));
  return {
    kind: 'effect',
    label: effect.name,
    color: cat ? cat.border : null,
    payload: { effectId: effect.id, effectType: effect.type },
  };
};

Favorites.buildScene = function (scene) {
  if (!scene) return null;
  return { kind: 'scene', label: scene.name, payload: { sceneId: scene.id } };
};

Favorites.buildAction = function (action) {
  if (!action) return null;
  return {
    kind: 'action',
    label: action.label,
    color: action.color || '#6366f1',
    icon: action.icon || null,
    payload: { actionId: action.id },
  };
};

Favorites.buildMoverPreset = function (preset) {
  if (!preset) return null;
  return { kind: 'mover_preset', label: preset.name, icon: preset.icon || '🎯', payload: { presetId: preset.id } };
};

Favorites.buildFxPalette = function (key) {
  const p = FX_PALETTE_PRESETS[key];
  if (!p) return null;
  return { kind: 'fx_palette', label: p.label, payload: { presetKey: key } };
};

Favorites.run = function (fav) {
  if (!fav) return;
  const p = fav.payload || {};
  switch (fav.kind) {
    case 'color': {
      const idx = p.colorIndex;
      if (idx == null || !COLORS[idx]) return;
      if (S.colorHoldMode) {
        S.selectedColor = idx;
        Actions.colorOn(COLORS[idx]);
      } else if (S.selectedColor === idx) {
        S.selectedColor = null;
        Actions.colorOff();
      } else {
        S.selectedColor = idx;
        Actions.colorOn(COLORS[idx]);
      }
      UI.renderColors();
      break;
    }
    case 'effect': {
      Actions.toggleEffect(p.effectId, p.effectType);
      UI.renderEffects();
      UI.renderFxPalette();
      break;
    }
    case 'scene': {
      if (S.activeSceneId === p.sceneId) Actions.deactivateScene();
      else Actions.activateScene(p.sceneId);
      UI.renderScenes();
      UI.renderActionsGrid();
      break;
    }
    case 'action': {
      const action = S.touchActions.find((a) => a.id === p.actionId);
      if (!action) return;
      if (action.action_type === 'scene') {
        const sid = (action.action_data || {}).scene_id;
        if (!sid) return;
        if (S.activeSceneId === sid) Actions.deactivateScene();
        else Actions.activateScene(sid);
        UI.renderScenes();
        UI.renderActionsGrid();
      } else {
        Actions.executeTouchAction(action, true);
        setTimeout(() => Actions.executeTouchAction(action, false), 300);
      }
      break;
    }
    case 'mover_preset':
      Actions.applyMoverPreset(p.presetId, getSelectedMovers().map((f) => f.id));
      break;
    case 'fx_palette':
      Actions.applyFxPalettePreset(p.presetKey);
      break;
  }
  UI.renderPanelNav();
  if (S.activePanel === 'favorites') UI.renderFavorites();
};

/** Double-tap / double-click to add favorite without triggering primary action twice. */
function bindFavoriteDblTap(el, getItemFn) {
  let lastTap = 0;
  let touchMoved = false;
  let startX = 0;
  let startY = 0;

  el.addEventListener('touchstart', (e) => {
    touchMoved = false;
    if (e.touches.length === 1) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!e.touches.length) return;
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > 12 || dy > 12) touchMoved = true;
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (touchMoved) return;
    const now = Date.now();
    if (now - lastTap < 450) {
      lastTap = 0;
      e.preventDefault();
      e.stopPropagation();
      const item = typeof getItemFn === 'function' ? getItemFn() : null;
      if (item) Favorites.add(item);
    } else {
      lastTap = now;
    }
  }, { passive: false });

  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const item = typeof getItemFn === 'function' ? getItemFn() : null;
    if (item) Favorites.add(item);
  });
}
