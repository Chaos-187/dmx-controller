/**
 * Persistent registry of paired Thaluxis Hub instances (one active at a time).
 */

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_HUB_NAME = 'Thaluxis Hub';

function normalizeUrl(url) {
  if (!url) return '';
  let u = String(url).trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

function urlKey(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.hostname.toLowerCase()}:${port}`;
  } catch {
    return normalizeUrl(url).toLowerCase();
  }
}

class HubRegistry {
  constructor({ dataPath, legacyConfig = null }) {
    this.dataPath = dataPath;
    this.activeHubId = '';
    this.hubs = [];
    this._runtime = new Map(); // hub id → { connected, last_error, hub_product_name }
    this.load(legacyConfig);
  }

  load(legacyConfig) {
    if (fs.existsSync(this.dataPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.activeHubId = data.active_hub_id || '';
        this.hubs = Array.isArray(data.hubs) ? data.hubs.map((h) => this._normalizeEntry(h)) : [];
      } catch (e) {
        console.warn(`[HubRegistry] Invalid ${this.dataPath}: ${e.message}`);
      }
    }

    if (this.hubs.length === 0 && legacyConfig?.hub_url) {
      const hub = this._createEntry({
        name: legacyConfig.hub_name || DEFAULT_HUB_NAME,
        hub_url: legacyConfig.hub_url,
        token: legacyConfig.satellite_token || '',
        pair_status: legacyConfig.satellite_token ? 'approved' : 'pending',
      });
      this.hubs.push(hub);
      this.activeHubId = hub.id;
      this.save();
      console.log('[HubRegistry] Migrated legacy single-hub config');
    }

    if (!this.activeHubId && this.hubs.length) {
      this.activeHubId = this.hubs[0].id;
      this.save();
    }
  }

  save() {
    fs.mkdirSync(require('path').dirname(this.dataPath), { recursive: true });
    fs.writeFileSync(this.dataPath, JSON.stringify({
      active_hub_id: this.activeHubId,
      hubs: this.hubs.map(({ id, name, hub_url, token, pair_status, hub_product_name, created_at, updated_at }) => ({
        id,
        name,
        hub_url,
        token,
        pair_status,
        hub_product_name: hub_product_name || '',
        created_at,
        updated_at,
      })),
    }, null, 2));
  }

  _normalizeEntry(h) {
    return {
      id: h.id || crypto.randomUUID(),
      name: h.name || DEFAULT_HUB_NAME,
      hub_url: normalizeUrl(h.hub_url),
      token: h.token || '',
      pair_status: h.pair_status || (h.token ? 'approved' : 'pending'),
      hub_product_name: h.hub_product_name || '',
      created_at: h.created_at || new Date().toISOString(),
      updated_at: h.updated_at || new Date().toISOString(),
    };
  }

  _createEntry({ name, hub_url, token = '', pair_status = 'pending', hub_product_name = '' }) {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      name: name || DEFAULT_HUB_NAME,
      hub_url: normalizeUrl(hub_url),
      token,
      pair_status: token ? 'approved' : pair_status,
      hub_product_name,
      created_at: now,
      updated_at: now,
    };
  }

  _touch(hub, patch = {}) {
    Object.assign(hub, patch, { updated_at: new Date().toISOString() });
    this.save();
    return hub;
  }

  getAll() {
    return this.hubs.map((h) => this._publicHub(h));
  }

  getById(id) {
    return this.hubs.find((h) => h.id === id) || null;
  }

  getActive() {
    return this.getById(this.activeHubId) || this.hubs[0] || null;
  }

  findByUrl(hubUrl) {
    const key = urlKey(hubUrl);
    return this.hubs.find((h) => urlKey(h.hub_url) === key) || null;
  }

  setRuntime(id, patch) {
    const prev = this._runtime.get(id) || {};
    this._runtime.set(id, { ...prev, ...patch });
  }

  _publicHub(h) {
    const rt = this._runtime.get(h.id) || {};
    return {
      id: h.id,
      name: h.name,
      hub_url: h.hub_url,
      pair_status: h.pair_status,
      hub_product_name: h.hub_product_name || rt.hub_product_name || '',
      active: h.id === this.activeHubId,
      connected: !!rt.connected,
      last_error: rt.last_error || null,
      last_seen_at: rt.last_seen_at || null,
      has_token: !!h.token,
      created_at: h.created_at,
      updated_at: h.updated_at,
    };
  }

  add({ hub_url, name }) {
    const url = normalizeUrl(hub_url);
    if (!url) throw new Error('Hub URL required');

    const existing = this.findByUrl(url);
    if (existing) return existing;

    const hub = this._createEntry({ name: name || DEFAULT_HUB_NAME, hub_url: url });
    this.hubs.push(hub);
    if (!this.activeHubId) this.activeHubId = hub.id;
    this.save();
    return hub;
  }

  update(id, { name, hub_url }) {
    const hub = this.getById(id);
    if (!hub) throw new Error('Hub not found');

    if (name != null) hub.name = String(name).trim() || hub.name;
    if (hub_url != null) {
      const url = normalizeUrl(hub_url);
      if (!url) throw new Error('Hub URL required');
      const dupe = this.findByUrl(url);
      if (dupe && dupe.id !== id) throw new Error('A hub with that URL already exists');
      hub.hub_url = url;
    }
    return this._touch(hub);
  }

  setActive(id) {
    const hub = this.getById(id);
    if (!hub) throw new Error('Hub not found');
    this.activeHubId = id;
    this.save();
    return hub;
  }

  remove(id) {
    const idx = this.hubs.findIndex((h) => h.id === id);
    if (idx < 0) throw new Error('Hub not found');
    this.hubs.splice(idx, 1);
    this._runtime.delete(id);
    if (this.activeHubId === id) {
      this.activeHubId = this.hubs[0]?.id || '';
    }
    this.save();
  }

  setPairStatus(id, pair_status, token) {
    const hub = this.getById(id);
    if (!hub) return null;
    hub.pair_status = pair_status;
    if (token) hub.token = token;
    return this._touch(hub);
  }

  setHubInfo(id, { hub_product_name }) {
    const hub = this.getById(id);
    if (!hub) return null;
    if (hub_product_name != null) hub.hub_product_name = hub_product_name;
    return this._touch(hub);
  }

  /** Legacy sync for env / old config fields */
  getLegacyConfigFields() {
    const active = this.getActive();
    return {
      hub_url: active?.hub_url || '',
      satellite_token: active?.token || '',
    };
  }
}

module.exports = { HubRegistry, normalizeUrl, urlKey, DEFAULT_HUB_NAME };
