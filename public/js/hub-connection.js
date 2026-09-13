/**
 * Hub WebSocket connection lost UI — shared by index.html and config.html.
 */
(function (global) {
  let retryFn = null;
  let updateStatusBar = true;
  let hadOpen = false;
  let hubReady = false;
  let showTimer = null;

  function ensureOverlay() {
    let root = document.getElementById('hubConnectionOverlay');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'hubConnectionOverlay';
    root.className = 'hub-connection-overlay';
    root.hidden = true;
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-labelledby', 'hubConnectionTitle');
    root.innerHTML = `
      <div class="hub-connection-panel">
        <h2 id="hubConnectionTitle">Connection lost</h2>
        <p class="hub-connection-msg" id="hubConnectionMsg">
          The hub stopped responding. DMX and deck data will not update until the connection is restored.
        </p>
        <p class="hub-connection-sub" id="hubConnectionSub">Reconnecting automatically…</p>
        <div class="hub-connection-actions">
          <button type="button" class="btn btn-primary" id="hubConnectionRetry">Retry now</button>
          <button type="button" class="btn btn-secondary" id="hubConnectionReload">Reload page</button>
        </div>
      </div>`;
    document.body.appendChild(root);

    root.querySelector('#hubConnectionRetry').addEventListener('click', () => {
      if (typeof retryFn === 'function') retryFn();
    });
    root.querySelector('#hubConnectionReload').addEventListener('click', () => {
      location.reload();
    });
    return root;
  }

  function showLost(detail) {
    const root = ensureOverlay();
    root.hidden = false;
    const sub = document.getElementById('hubConnectionSub');
    if (sub) sub.textContent = detail || 'Reconnecting automatically…';
    if (updateStatusBar) {
      const dot = document.getElementById('statusDot');
      const txt = document.getElementById('statusText');
      if (dot) dot.classList.remove('connected');
      if (txt) txt.textContent = 'Hub disconnected';
    }
  }

  function hideLost() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    const root = document.getElementById('hubConnectionOverlay');
    if (root) root.hidden = true;
  }

  function notifyOpen() {
    hadOpen = true;
    hideLost();
    if (updateStatusBar) {
      const dot = document.getElementById('statusDot');
      const txt = document.getElementById('statusText');
      if (dot) dot.classList.add('connected');
      if (txt && (txt.textContent === 'Hub disconnected' || txt.textContent === 'Connecting…')) {
        txt.textContent = hubReady ? 'Connected' : 'Starting hub…';
      }
    }
  }

  function notifyClose() {
    if (!hadOpen && !hubReady) return;
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showLost();
    }, 600);
  }

  function notifyHubReady() {
    hubReady = true;
    hideLost();
  }

  function notifyHubBooting() {
    hubReady = false;
  }

  function init(options = {}) {
    retryFn = options.onRetry || null;
    if (options.updateStatusBar === false) updateStatusBar = false;
    ensureOverlay();
  }

  global.HubConnection = {
    init,
    notifyOpen,
    notifyClose,
    notifyHubReady,
    notifyHubBooting,
    showLost,
    hideLost,
  };
})(typeof window !== 'undefined' ? window : globalThis);
