/**
 * mDNS discovery for DMX satellites and hubs on the LAN.
 */

const Bonjour = require('bonjour-service').Bonjour;

const STALE_MS = 90000;
const discoveredSatellites = new Map();
const discoveredHubs = new Map();

let satelliteBrowser = null;
let hubBrowser = null;
let bonjourInstance = null;

function pruneMap(map) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.last_seen > STALE_MS) map.delete(key);
  }
}

function pickAddress(service) {
  const addrs = service.addresses || [];
  const v4 = addrs.find(a => a.includes('.') && !a.startsWith('127.'));
  return v4 || addrs[0] || service.host || '';
}

function normalizeSatellite(service) {
  const deviceId = service.txt?.device_id || '';
  const ip = pickAddress(service);
  const webPort = parseInt(service.txt?.web_port || service.port || '8788', 10);
  return {
    key: deviceId || `${service.name}:${ip}:${webPort}`,
    device_id: deviceId,
    name: service.txt?.name || service.name,
    host: service.host,
    ip,
    web_port: webPort,
    os2l_port: parseInt(service.txt?.os2l_port || '8787', 10),
    last_seen: Date.now(),
  };
}

function normalizeHub(service) {
  const ip = pickAddress(service);
  const port = service.port || 80;
  return {
    key: `${service.name}:${ip}:${port}`,
    name: service.name,
    host: service.host,
    ip,
    port,
    path: service.txt?.path || '/api/hub/status',
    last_seen: Date.now(),
  };
}

function getDiscoveredSatellites() {
  pruneMap(discoveredSatellites);
  return [...discoveredSatellites.values()].sort((a, b) => b.last_seen - a.last_seen);
}

function getDiscoveredHubs() {
  pruneMap(discoveredHubs);
  return [...discoveredHubs.values()].sort((a, b) => b.last_seen - a.last_seen);
}

function startSatelliteDiscovery(onUpdate) {
  if (!bonjourInstance) bonjourInstance = new Bonjour();
  if (satelliteBrowser) return;

  satelliteBrowser = bonjourInstance.find({ type: 'dmx-satellite' }, (service) => {
    const entry = normalizeSatellite(service);
    discoveredSatellites.set(entry.key, entry);
    onUpdate?.(getDiscoveredSatellites());
  });
}

function startHubDiscovery(onUpdate) {
  if (!bonjourInstance) bonjourInstance = new Bonjour();
  if (hubBrowser) return;

  hubBrowser = bonjourInstance.find({ type: 'dmx-hub' }, (service) => {
    const entry = normalizeHub(service);
    discoveredHubs.set(entry.key, entry);
    onUpdate?.(getDiscoveredHubs());
  });
}

function stopDiscovery() {
  satelliteBrowser?.stop?.();
  hubBrowser?.stop?.();
  satelliteBrowser = null;
  hubBrowser = null;
  bonjourInstance?.destroy?.();
  bonjourInstance = null;
  discoveredSatellites.clear();
  discoveredHubs.clear();
}

module.exports = {
  startSatelliteDiscovery,
  startHubDiscovery,
  stopDiscovery,
  getDiscoveredSatellites,
  getDiscoveredHubs,
};
