/**
 * Art-Net Server — Orchestrator
 *
 * Spawns the artnet-worker.js in a separate thread and provides
 * a clean API for the main server to manage Art-Net output nodes
 * and send DMX channel data without blocking the event loop.
 *
 * Modelled after the Project_Imposter lighting-server.js pattern.
 */

const path = require('path');
const { Worker } = require('worker_threads');

class ArtNetServer {
  constructor() {
    this.worker = null;
    this.isReady = false;
    this._readyCallbacks = [];
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Start the Art-Net worker thread and load nodes from the database.
   * @param {Array} nodes  Array of artnet_universes rows from DB
   * @param {number} rate  Transmit rate in Hz (default 44)
   */
  start(nodes = [], rate = 44) {
    if (this.worker) {
      console.log('[Art-Net] Already running');
      return;
    }

    const workerPath = path.resolve(__dirname, 'artnet-worker.js');
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg) => this._handleMessage(msg));

    this.worker.on('error', (err) => {
      console.error(`[Art-Net] Worker error: ${err.message}`);
    });

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[Art-Net] Worker exited with code ${code}`);
      }
      this.worker = null;
      this.isReady = false;
    });

    // Once ready, load nodes and start transmitting
    this._onReady(() => {
      for (const node of nodes) {
        this._send('upsertNode', {
          id: node.id,
          ip: node.ip,
          port: node.port,
          subnet: node.subnet,
          artnetUniverse: node.artnet_universe,
          localUniverse: node.local_universe,
          enabled: !!node.enabled,
        });
      }
      if (nodes.some(n => n.enabled)) {
        this._send('startTx', { rate });
      }
      console.log(`[Art-Net] Started with ${nodes.length} node(s) @ ${rate} Hz`);
    });
  }

  /**
   * Gracefully shut down the worker.
   */
  shutdown() {
    if (!this.worker) return;

    console.log('[Art-Net] Shutting down...');
    this._send('shutdown');

    const ref = this.worker;
    const forceTimeout = setTimeout(() => {
      if (ref === this.worker) {
        console.warn('[Art-Net] Forcing worker termination');
        ref.terminate();
      }
    }, 3000);

    ref.once('exit', () => clearTimeout(forceTimeout));
  }

  // ─── Public API (called from main thread) ───────────────────────────────

  /** Add or update an Art-Net output node */
  upsertNode(node) {
    this._send('upsertNode', {
      id: node.id,
      ip: node.ip,
      port: node.port,
      subnet: node.subnet,
      artnetUniverse: node.artnet_universe,
      localUniverse: node.local_universe,
      enabled: node.enabled !== undefined ? !!node.enabled : true,
    });
  }

  /** Remove an Art-Net output node */
  removeNode(id) {
    this._send('removeNode', { id });
  }

  /** Set a single DMX channel value */
  setChannel(localUniverse, channel, value) {
    this._send('setChannel', { localUniverse, channel, value });
  }

  /** Set multiple channels: [{ch, val}] */
  setChannels(localUniverse, channels) {
    this._send('setChannels', { localUniverse, channels });
  }

  /** Set full 512-byte universe buffer */
  setFullUniverse(localUniverse, data) {
    this._send('setFullUniverse', { localUniverse, data: Array.from(data) });
  }

  /** Blackout all universes */
  blackout() {
    this._send('blackout');
  }

  /** Start transmit loop */
  startTx(rate) {
    this._send('startTx', { rate: rate || 44 });
  }

  /** Stop transmit loop */
  stopTx() {
    this._send('stopTx');
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  _send(action, payload = {}) {
    if (!this.worker) return;
    this.worker.postMessage({ action, payload });
  }

  _handleMessage(msg) {
    if (!msg) return;

    switch (msg.type) {
      case 'ready':
        this.isReady = true;
        for (const cb of this._readyCallbacks) cb();
        this._readyCallbacks = [];
        break;
      case 'log':
        (console[msg.level] || console.log)(msg.message);
        break;
      case 'error':
        console.error('[Art-Net]', msg.error);
        break;
      case 'shutdown-complete':
        console.log('[Art-Net] Worker shutdown complete');
        break;
    }
  }

  _onReady(cb) {
    if (this.isReady) {
      cb();
    } else {
      this._readyCallbacks.push(cb);
    }
  }
}

module.exports = ArtNetServer;
