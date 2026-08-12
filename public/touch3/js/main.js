/* Thaluxis Touch 3 — bootstrap + event wiring */
'use strict';

/* ── PIN lock ── */
const Pin = {
  enabled: false,
  length: 4,
  idleTimeout: 0,
  entered: '',
  idleTimer: null,
};

async function initPin() {
  try {
    const s = await fetch('/api/touch-pin/status').then((r) => r.json());
    Pin.enabled = !!s.enabled;
    Pin.length = s.pinLength || 4;
    Pin.idleTimeout = s.idleTimeout || 0;
  } catch { Pin.enabled = false; }

  if (!Pin.enabled) return;
  showPinOverlay();

  document.querySelectorAll('.pin-key[data-digit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (Pin.entered.length >= Pin.length) return;
      Pin.entered += btn.dataset.digit;
      renderPinDots();
      if (Pin.entered.length === Pin.length) verifyPin();
    });
  });
  document.getElementById('pinBackspace').addEventListener('click', () => {
    Pin.entered = Pin.entered.slice(0, -1);
    renderPinDots();
  });

  if (Pin.idleTimeout > 0) {
    const reset = () => {
      clearTimeout(Pin.idleTimer);
      Pin.idleTimer = setTimeout(showPinOverlay, Pin.idleTimeout * 1000);
    };
    ['touchstart', 'mousedown', 'keydown'].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
    reset();
  }
}

function showPinOverlay() {
  Pin.entered = '';
  renderPinDots();
  document.getElementById('pinOverlay').classList.add('active');
}

function renderPinDots() {
  const host = document.getElementById('pinDots');
  host.classList.remove('error');
  host.innerHTML = Array.from({ length: Pin.length }, (_, i) =>
    '<span class="pin-dot' + (i < Pin.entered.length ? ' filled' : '') + '"></span>').join('');
}

async function verifyPin() {
  try {
    const r = await fetch('/api/touch-pin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: Pin.entered }),
    });
    if (r.ok) {
      document.getElementById('pinOverlay').classList.remove('active');
      Pin.entered = '';
      return;
    }
  } catch { /* fall through to error state */ }
  document.getElementById('pinDots').classList.add('error');
  setTimeout(() => { Pin.entered = ''; renderPinDots(); }, 450);
}

/* ── Slider helper (updates label live, throttles server calls) ── */
function bindSlider(sliderId, valId, onChange, format) {
  const el = document.getElementById(sliderId);
  const val = document.getElementById(valId);
  let pending = null;
  el.addEventListener('input', () => {
    const v = +el.value;
    val.textContent = format ? format(v) : v;
    if (pending) return;
    pending = setTimeout(() => { pending = null; onChange(+el.value); }, 60);
  });
}

/* ── Event wiring ── */
function initControls() {
  document.getElementById('btnOutput').addEventListener('click', () => {
    Actions.toggleOutput();
    UI.renderTopButtons();
  });

  const bkBtn = document.getElementById('btnBlackout');
  bindHoldToggle(
    bkBtn,
    () => { Actions.setBlackout(true); UI.renderTopButtons(); },
    () => { Actions.setBlackout(false); UI.renderTopButtons(); },
    () => false, // blackout is always toggle
  );

  // Color hold/toggle switch
  document.querySelectorAll('#colorModeSwitch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      S.colorHoldMode = btn.dataset.mode === 'hold';
      document.querySelectorAll('#colorModeSwitch button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (S.colorHoldMode && S.selectedColor !== null) {
        Actions.colorOff();
        S.selectedColor = null;
      }
      UI.renderColors();
    });
  });

  bindSlider('colorIntensity', 'colorIntVal', (v) => {
    S.colorIntensity = v;
    if (S.selectedColor !== null) Actions.colorOn(COLORS[S.selectedColor]);
  });

  bindSlider('effectSpeed', 'effectSpeedVal', (v) => {
    Actions.setEffectSpeed(v / 100);
  }, (v) => (v / 100).toFixed(1) + 'x');

  document.getElementById('btnStopAllFx').addEventListener('click', () => {
    Actions.stopAllEffects();
    UI.renderEffects();
    UI.renderFxPalette();
  });

  bindSlider('masterDim', 'masterDimVal', (v) => Actions.setMasterDimmer(v));

  // Movers
  const sendPosition = () => {
    Actions.sendMoverPosition(
      getSelectedMovers().map((f) => f.id),
      +document.getElementById('manualPan').value,
      +document.getElementById('manualTilt').value,
      +document.getElementById('manualSpeed').value,
    );
  };
  bindSlider('manualPan', 'panVal', sendPosition);
  bindSlider('manualTilt', 'tiltVal', sendPosition);
  bindSlider('manualSpeed', 'speedVal', sendPosition);
  document.getElementById('btnClearMove').addEventListener('click', () => {
    Actions.clearMovementOverride(getSelectedMovers().map((f) => f.id));
  });

  // Lights modal
  const modal = document.getElementById('lightsModal');
  document.getElementById('btnLights').addEventListener('click', () => modal.classList.add('open'));
  document.getElementById('btnCloseLights').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

  const moversModal = document.getElementById('moversModal');
  const btnMovers = document.getElementById('btnMovers');
  if (btnMovers && moversModal) {
    btnMovers.addEventListener('click', () => moversModal.classList.add('open'));
    document.getElementById('btnCloseMovers').addEventListener('click', () => moversModal.classList.remove('open'));
    moversModal.addEventListener('click', (e) => { if (e.target === moversModal) moversModal.classList.remove('open'); });
  }
  document.getElementById('btnAllOn').addEventListener('click', () => {
    S.fixtures.forEach((f) => Actions.setFixtureEnabled(f.id, true));
    UI.renderFixtureGrid();
    UI.renderGroupToggles();
  });
  document.getElementById('btnAllOff').addEventListener('click', () => {
    S.fixtures.forEach((f) => Actions.setFixtureEnabled(f.id, false));
    UI.renderFixtureGrid();
    UI.renderGroupToggles();
  });

  document.querySelectorAll('.panel-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => UI.setPanel(btn.dataset.panel));
  });

  const favAddModal = document.getElementById('favAddModal');
  document.getElementById('btnFavAdd').addEventListener('click', () => UI.openFavAddModal());
  document.getElementById('btnCloseFavAdd').addEventListener('click', () => favAddModal.classList.remove('open'));
  favAddModal.addEventListener('click', (e) => { if (e.target === favAddModal) favAddModal.classList.remove('open'); });
  document.getElementById('btnFavEdit').addEventListener('click', () => {
    S.favEditMode = !S.favEditMode;
    UI.renderFavorites();
  });
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  initPin();
  await fetchAllData();
  initControls();
  UI.renderAll();
  connectWebSocket();
});
