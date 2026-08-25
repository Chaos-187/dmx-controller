/**
 * Hub client — pairing, discovery, and sync with the main DMX Controller.
 */

const http = require('http');
const https = require('https');

class HubClient {
  constructor({ baseUrl, token, name = 'Thaluxis Satellite', deviceId = '' }) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
    this.name = name;
    this.deviceId = deviceId || '';
    this.connected = false;
    this.lastError = null;
    this.lastPingAt = null;
  }

  _url(path) {
    if (!this.baseUrl) return null;
    try {
      return new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    } catch {
      return null;
    }
  }

  request(method, path, body, { auth = true } = {}) {
    const url = this._url(path);
    if (!url) {
      return Promise.resolve({ ok: false, status: 0, data: { error: 'Hub URL not configured' } });
    }

    const payload = body != null ? JSON.stringify(body) : null;
    const lib = url.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Satellite-Name': this.name,
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    };

    if (auth && this.token) {
      headers['X-Satellite-Token'] = this.token;
      if (this.deviceId) headers['X-Satellite-Device-Id'] = this.deviceId;
    }

    return new Promise((resolve) => {
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 15000,
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch { data = { error: raw || 'Invalid JSON' }; }
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          this.connected = ok;
          this.lastError = ok ? null : (data?.error || `HTTP ${res.statusCode}`);
          resolve({ ok, status: res.statusCode, data });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        this.connected = false;
        this.lastError = 'Hub request timed out';
        resolve({ ok: false, status: 0, data: { error: this.lastError } });
      });

      req.on('error', (err) => {
        this.connected = false;
        this.lastError = err.message;
        resolve({ ok: false, status: 0, data: { error: err.message } });
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  ping() {
    return this.request('GET', '/api/hub/status', null, { auth: false }).then((res) => {
      if (res.ok) this.lastPingAt = Date.now();
      return res;
    });
  }

  requestPairing({ deviceId, ip, webPort, os2lPort }) {
    return this.request('POST', '/api/hub/pair/request', {
      device_id: deviceId,
      name: this.name,
      ip,
      web_port: webPort,
      os2l_port: os2lPort,
    }, { auth: false });
  }

  pairStatus(deviceId) {
    return this.request('GET', `/api/hub/pair/status?device_id=${encodeURIComponent(deviceId)}`, null, { auth: false });
  }

  syncTrack(track) {
    return this.request('POST', '/api/hub/tracks/sync', { track, satellite_name: this.name });
  }

  pushAnalysis(trackId, analysis) {
    return this.request('POST', `/api/hub/tracks/${trackId}/analysis`, { analysis });
  }

  forwardOs2l(data) {
    return this.request('POST', '/api/hub/os2l', data);
  }
}

module.exports = HubClient;
