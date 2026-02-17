/**
 * DMX USB Server — Orchestrator
 *
 * Spawns the dmx-usb-worker.js in a separate thread and provides
 * a clean API for the main server to manage DMX USB output via
 * FTDI D2XX without blocking the event loop.
 *
 * Mirrors the ArtNetServer pattern.
 */

const path = require('path');
const { Worker } = require('worker_threads');

class DmxUsbServer {
  constructor() {
    this.worker = null;
    this.isReady = false;
    this.isOpen = false;
    this.deviceIdentifier = null;
    this._readyCallbacks = [];
    this._pendingCallbacks = new Map();
    this._callbackId = 0;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Start the DMX USB worker thread.
   */
  start() {
    if (this.worker) {
      console.log('[DMX-USB] Already running');
      return;
    }

    const workerPath = path.resolve(__dirname, 'dmx-usb-worker.js');
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg) => this._handleMessage(msg));

    this.worker.on('error', (err) => {
      console.error(`[DMX-USB] Worker error: ${err.message}`);
    });

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[DMX-USB] Worker exited with code ${code}`);
      }
      this.worker = null;
      this.isReady = false;
      this.isOpen = false;
    });

    console.log('[DMX-USB] Worker started');
  }

  /**
   * Gracefully shut down the worker.
   */
  shutdown() {
    if (!this.worker) return;

    console.log('[DMX-USB] Shutting down...');
    this._send('shutdown');

    const ref = this.worker;
    const forceTimeout = setTimeout(() => {
      if (ref === this.worker) {
        console.warn('[DMX-USB] Forcing worker termination');
        ref.terminate();
      }
    }, 3000);

    ref.once('exit', () => clearTimeout(forceTimeout));
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * List all FTDI devices connected to the system.
   * Returns a promise that resolves with the device list.
   */
  listDevices() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 5000);

      const handler = (msg) => {
        if (msg.type === 'deviceList') {
          clearTimeout(timeout);
          this.worker?.removeListener('message', handler);
          resolve(msg.devices || []);
        }
      };

      if (this.worker) {
        this.worker.on('message', handler);
        this._send('listDevices');
      } else {
        clearTimeout(timeout);
        resolve([]);
      }
    });
  }

  /**
   * Open an FTDI device for DMX output.
   * @param {object} identifier  { serial_number } or { description } or { usb_loc_id }
   * @returns {Promise<boolean>}
   */
  open(identifier) {
    return this._openPromise('open', identifier);
  }

  /**
   * Open a USB device for DMX output via libusb bulk transfer.
   * @param {object} payload  { vid, pid, serial_number }
   * @returns {Promise<boolean>}
   */
  openUsb(payload) {
    return this._openPromise('openUsb', payload);
  }

  /** Internal: send open/openUsb and wait for response */
  _openPromise(action, payload) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);

      const handler = (msg) => {
        if (msg.type === 'opened') {
          clearTimeout(timeout);
          this.worker?.removeListener('message', handler);
          this.isOpen = true;
          this.deviceIdentifier = msg.identifier || payload;
          resolve(true);
        } else if (msg.type === 'error' && msg.action === 'open') {
          clearTimeout(timeout);
          this.worker?.removeListener('message', handler);
          resolve(false);
        }
      };

      if (this.worker) {
        this.worker.on('message', handler);
        this._send(action, payload);
      } else {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  /**
   * Close the current FTDI device.
   */
  close() {
    this.isOpen = false;
    this.deviceIdentifier = null;
    this._send('close');
  }

  /** Set a single DMX channel value (1-512) */
  setChannel(channel, value) {
    this._send('setChannel', { channel, value });
  }

  /** Set multiple channels: [{ch, val}] */
  setChannels(channels) {
    this._send('setChannels', { channels });
  }

  /** Set full 512-byte universe buffer */
  setFullUniverse(data) {
    this._send('setFullUniverse', { data: Array.from(data) });
  }

  /** Blackout (zero all channels) */
  blackout() {
    this._send('blackout');
  }

  /** Save current DMX buffer (for later restore) */
  saveBuffers() {
    this._send('saveBuffers');
  }

  /** Restore previously saved DMX buffer */
  restoreBuffers() {
    this._send('restoreBuffers');
  }

  /** Start the DMX transmit loop */
  startTx(rate) {
    this._send('startTx', { rate: rate || 40 });
  }

  /** Stop the DMX transmit loop */
  stopTx() {
    this._send('stopTx');
  }

  /** Switch break method: 'baud' (default) or 'break' */
  setBreakMethod(method) {
    this._send('setBreakMethod', { method });
  }

  /** Get current status */
  getStatus() {
    return {
      running: !!this.worker,
      ready: this.isReady,
      open: this.isOpen,
      device: this.deviceIdentifier,
    };
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
      case 'opened':
        this.isOpen = true;
        this.deviceIdentifier = msg.identifier;
        console.log(`[DMX-USB] Device opened: ${JSON.stringify(msg.identifier)}`);
        break;
      case 'closed':
        this.isOpen = false;
        this.deviceIdentifier = null;
        console.log('[DMX-USB] Device closed');
        break;
      case 'txStarted':
        console.log(`[DMX-USB] TX started at ${msg.rate} Hz`);
        break;
      case 'log':
        (console[msg.level] || console.log)(msg.message);
        break;
      case 'error':
        console.error('[DMX-USB]', msg.error);
        if (msg.action === 'tx') {
          this.isOpen = false;
          this.deviceIdentifier = null;
        }
        break;
      case 'shutdown-complete':
        console.log('[DMX-USB] Worker shutdown complete');
        break;
      // deviceList is handled by the promise-based listDevices()
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

module.exports = DmxUsbServer;
