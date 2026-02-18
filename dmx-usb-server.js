/**
 * DMX USB Server — Multi-Device Orchestrator
 *
 * Manages multiple USB DMX adapters, each running in its own worker
 * thread. Each adapter is mapped to a local DMX universe so the
 * main server can route channel data by universe number.
 *
 * Usage:
 *   const mgr = new DmxUsbServer();
 *   await mgr.openDevice({ id: 1, source: 'ftdi', serial_number: 'AL00XXXX', local_universe: 1, refresh_rate: 40 });
 *   mgr.setChannels(1, [{ ch: 1, val: 255 }]);  // universe 1
 *   await mgr.shutdownAll();
 */

const path = require('path');
const { Worker } = require('worker_threads');

// ─── Single Device Handle ─────────────────────────────────────────────────

class UsbDeviceHandle {
  /**
   * @param {object} config  Row from usb_devices table
   */
  constructor(config) {
    this.config = config;
    this.worker = null;
    this.isReady = false;
    this.isOpen = false;
    this.deviceIdentifier = null;
    this._tag = `[USB:${config.label || config.id}]`;
  }

  /** Spawn the worker thread */
  start() {
    if (this.worker) return;
    const workerPath = path.resolve(__dirname, 'dmx-usb-worker.js');
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg) => this._handleMessage(msg));
    this.worker.on('error', (err) => console.error(`${this._tag} Worker error: ${err.message}`));
    this.worker.on('exit', (code) => {
      if (code !== 0) console.error(`${this._tag} Worker exited with code ${code}`);
      this.worker = null;
      this.isReady = false;
      this.isOpen = false;
    });

    console.log(`${this._tag} Worker started`);
  }

  /** Open the device according to its config (FTDI or libusb) */
  open() {
    const cfg = this.config;
    if (cfg.source === 'usb') {
      return this._openPromise('openUsb', {
        vid: cfg.vid, pid: cfg.pid, serial_number: cfg.serial_number || '',
      });
    } else {
      const identifier = cfg.serial_number
        ? { serial_number: cfg.serial_number }
        : cfg.description ? { description: cfg.description } : null;
      if (!identifier) return Promise.resolve(false);
      return this._openPromise('open', identifier);
    }
  }

  /** Start the DMX TX loop at the configured rate */
  startTx() {
    this._send('startTx', { rate: this.config.refresh_rate || 40 });
  }

  /** List connected FTDI devices via this worker */
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

  setChannel(channel, value) { this._send('setChannel', { channel, value }); }
  setChannels(channels)      { this._send('setChannels', { channels }); }
  setFullUniverse(data)      { this._send('setFullUniverse', { data: Array.from(data) }); }
  blackout()                 { this._send('blackout'); }
  saveBuffers()              { this._send('saveBuffers'); }
  restoreBuffers()           { this._send('restoreBuffers'); }
  stopTx()                   { this._send('stopTx'); }

  close() {
    this.isOpen = false;
    this.deviceIdentifier = null;
    this._send('close');
  }

  /** Gracefully shut down the worker */
  shutdown() {
    if (!this.worker) return Promise.resolve();
    return new Promise((resolve) => {
      const ref = this.worker;
      const forceTimeout = setTimeout(() => {
        if (ref === this.worker) {
          console.warn(`${this._tag} Forcing worker termination`);
          ref.terminate();
        }
        resolve();
      }, 3000);
      ref.once('exit', () => { clearTimeout(forceTimeout); resolve(); });
      this._send('shutdown');
    });
  }

  getStatus() {
    return {
      id: this.config.id,
      label: this.config.label,
      local_universe: this.config.local_universe,
      running: !!this.worker,
      ready: this.isReady,
      open: this.isOpen,
      device: this.deviceIdentifier,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  _send(action, payload = {}) {
    if (!this.worker) return;
    this.worker.postMessage({ action, payload });
  }

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

  _handleMessage(msg) {
    if (!msg) return;
    switch (msg.type) {
      case 'ready':
        this.isReady = true;
        break;
      case 'opened':
        this.isOpen = true;
        this.deviceIdentifier = msg.identifier;
        console.log(`${this._tag} Device opened: ${JSON.stringify(msg.identifier)}`);
        break;
      case 'closed':
        this.isOpen = false;
        this.deviceIdentifier = null;
        console.log(`${this._tag} Device closed`);
        break;
      case 'txStarted':
        console.log(`${this._tag} TX started at ${msg.rate} Hz`);
        break;
      case 'log':
        (console[msg.level] || console.log)(msg.message);
        break;
      case 'error':
        console.error(`${this._tag}`, msg.error);
        if (msg.action === 'tx') {
          this.isOpen = false;
          this.deviceIdentifier = null;
        }
        break;
      case 'shutdown-complete':
        console.log(`${this._tag} Worker shutdown complete`);
        break;
    }
  }
}

// ─── Multi-Device Manager ─────────────────────────────────────────────────

class DmxUsbServer {
  constructor() {
    /** @type {Map<number, UsbDeviceHandle>}  keyed by usb_devices.id */
    this.devices = new Map();
    /** @type {Map<number, Set<number>>}  universe → Set of device IDs */
    this.universeMap = new Map();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Open a device from a usb_devices DB row and start TX.
   * @param {object} config  Row from usb_devices table
   * @returns {Promise<boolean>}
   */
  async openDevice(config) {
    if (this.devices.has(config.id)) {
      await this.closeDevice(config.id);
    }

    const handle = new UsbDeviceHandle(config);
    handle.start();

    // Wait for worker ready
    await new Promise((resolve) => {
      const check = () => {
        if (handle.isReady) return resolve();
        setTimeout(check, 50);
      };
      check();
    });

    const success = await handle.open();
    if (!success) {
      console.error(`[DMX-USB] Failed to open device "${config.label}" (id=${config.id})`);
      await handle.shutdown();
      return false;
    }

    handle.startTx();
    this.devices.set(config.id, handle);
    this._rebuildUniverseMap();
    console.log(`[DMX-USB] Device "${config.label}" connected → universe ${config.local_universe}`);
    return true;
  }

  /**
   * Close a single device by its DB id.
   */
  async closeDevice(id) {
    const handle = this.devices.get(id);
    if (!handle) return;
    handle.close();
    await handle.shutdown();
    this.devices.delete(id);
    this._rebuildUniverseMap();
  }

  /**
   * Shut down all device workers.
   */
  async shutdownAll() {
    const promises = [];
    for (const [id, handle] of this.devices) {
      handle.close();
      promises.push(handle.shutdown());
    }
    await Promise.all(promises);
    this.devices.clear();
    this.universeMap.clear();
    console.log('[DMX-USB] All devices shut down');
  }

  // ─── Channel Routing ─────────────────────────────────────────────────

  /**
   * Set a single channel on all USB devices mapped to the given universe.
   */
  setChannel(universe, channel, value) {
    const ids = this.universeMap.get(universe);
    if (!ids) return;
    for (const id of ids) {
      const h = this.devices.get(id);
      if (h?.isOpen) h.setChannel(channel, value);
    }
  }

  /**
   * Set multiple channels on all USB devices mapped to the given universe.
   * @param {number} universe
   * @param {Array<{ch:number, val:number}>} channels
   */
  setChannels(universe, channels) {
    const ids = this.universeMap.get(universe);
    if (!ids) return;
    for (const id of ids) {
      const h = this.devices.get(id);
      if (h?.isOpen) h.setChannels(channels);
    }
  }

  /**
   * Blackout all connected USB devices.
   */
  blackout() {
    for (const h of this.devices.values()) {
      if (h.isOpen) h.blackout();
    }
  }

  /**
   * Save DMX buffers on all connected devices.
   */
  saveBuffers() {
    for (const h of this.devices.values()) {
      if (h.isOpen) h.saveBuffers();
    }
  }

  /**
   * Restore DMX buffers on all connected devices.
   */
  restoreBuffers() {
    for (const h of this.devices.values()) {
      if (h.isOpen) h.restoreBuffers();
    }
  }

  // ─── Query ────────────────────────────────────────────────────────────

  /**
   * Check if any USB device is open for the given universe.
   */
  isOpenForUniverse(universe) {
    const ids = this.universeMap.get(universe);
    if (!ids) return false;
    for (const id of ids) {
      const h = this.devices.get(id);
      if (h?.isOpen) return true;
    }
    return false;
  }

  /**
   * Check if any USB device is open at all.
   */
  get hasOpenDevices() {
    for (const h of this.devices.values()) {
      if (h.isOpen) return true;
    }
    return false;
  }

  /**
   * Get status of all devices.
   */
  getStatus() {
    const statuses = [];
    for (const h of this.devices.values()) {
      statuses.push(h.getStatus());
    }
    return { devices: statuses };
  }

  /**
   * Get status of a single device by DB id.
   */
  getDeviceStatus(id) {
    const h = this.devices.get(id);
    return h ? h.getStatus() : null;
  }

  /**
   * List FTDI devices via the first available worker (or a temp worker).
   */
  async listDevices() {
    // Use an existing handle if any
    for (const h of this.devices.values()) {
      if (h.isReady) return h.listDevices();
    }
    // Spin up a temporary worker just for scanning
    const tmp = new UsbDeviceHandle({ id: 0, label: '_scan' });
    tmp.start();
    await new Promise((resolve) => {
      const check = () => { if (tmp.isReady) return resolve(); setTimeout(check, 50); };
      check();
    });
    const devices = await tmp.listDevices();
    await tmp.shutdown();
    return devices;
  }

  // ─── Legacy compatibility ─────────────────────────────────────────────

  get isOpen() {
    return this.hasOpenDevices;
  }

  /** No-op: workers are started per-device via openDevice() */
  start() {}

  /** Shutdown alias */
  shutdown() {
    this.shutdownAll();
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  _rebuildUniverseMap() {
    this.universeMap.clear();
    for (const [id, handle] of this.devices) {
      const u = handle.config.local_universe;
      if (!this.universeMap.has(u)) this.universeMap.set(u, new Set());
      this.universeMap.get(u).add(id);
    }
  }
}

module.exports = DmxUsbServer;
